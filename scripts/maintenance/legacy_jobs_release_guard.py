#!/usr/bin/env python3
"""FinnBilGlass: read-only release guard for historical OPS cases, offers and orders.

Compare TWO isolated SQLite/D1 exports before/after a migration or release:
    python legacy_jobs_release_guard.py --before staging-before.sqlite --after staging-after.sqlite

Or audit one offline backup without comparing:
    python legacy_jobs_release_guard.py --before staging-before.sqlite

No credentials, HTTP requests, database writes, PII dumps or production operations.
Exit codes: 0 = verified; 1 = invariant, compatibility or retention failure;
2 = invalid input / unreadable backup. Never use a live database connection.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any

# Known operational tables. New tables in the AFTER export are allowed.
PROTECTED_TABLES = (
    "beta_inquiries",
    "beta_inquiry_events",
    "ops_manual_offers",
    "ops_manual_orders",
    "ops_offer_outbox",
    "ops_reply_outbox",
    "ops_mail_events",
    "ops_mail_details",
    "ops_staff_activity",
    "ops_work_events",
)
REQUIRED_TABLES = {"beta_inquiries"}


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def json_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return {"blob_sha256": hashlib.sha256(value).hexdigest()}
    return value


def stable_digest(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def open_read_only(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise ValueError("SQLite export not found: " + str(path))
    # sqlite3.connect's URI mode=ro will refuse creating or changing the database.
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    return db


def tables(db: sqlite3.Connection) -> set[str]:
    return {
        row["name"] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }


def columns(db: sqlite3.Connection, table: str) -> list[str]:
    return [row["name"] for row in db.execute(f"PRAGMA table_info({quote_identifier(table)})")]


def primary_key(db: sqlite3.Connection, table: str) -> list[str]:
    rows = list(db.execute(f"PRAGMA table_info({quote_identifier(table)})"))
    return [row["name"] for row in sorted(rows, key=lambda row: row["pk"]) if row["pk"]]


def table_fingerprint(
    db: sqlite3.Connection, table: str, compare_columns: list[str]
) -> Counter[tuple[str, str]]:
    # Multi-set comparison retains duplicates even for older tables without PK.
    cols = ", ".join(quote_identifier(col) for col in compare_columns)
    pk = primary_key(db, table)
    used_pk = [col for col in pk if col in compare_columns]
    result: Counter[tuple[str, str]] = Counter()
    for row in db.execute(f"SELECT {cols} FROM {quote_identifier(table)}"):
        record = {col: json_value(row[col]) for col in compare_columns}
        key = stable_digest({col: record[col] for col in used_pk}) if used_pk else "-"
        result[(key, stable_digest(record))] += 1
    return result


def audit(db: sqlite3.Connection, label: str) -> tuple[dict[str, Any], list[str]]:
    available = tables(db)
    errors: list[str] = []
    summary: dict[str, Any] = {"snapshot": label, "tables": {}, "foreign_keys": "ok"}
    for required in REQUIRED_TABLES - available:
        errors.append("MISSING_REQUIRED_TABLE:" + required)
    fk_violations = db.execute("PRAGMA foreign_key_check").fetchmany(5)
    if fk_violations:
        errors.append("FOREIGN_KEY_VIOLATIONS")
        summary["foreign_keys"] = "failed"

    for table in PROTECTED_TABLES:
        if table not in available:
            continue
        total = db.execute(f"SELECT COUNT(*) FROM {quote_identifier(table)}").fetchone()[0]
        summary["tables"][table] = total

    if "ops_manual_offers" in available:
        cols = set(columns(db, "ops_manual_offers"))
        required = {"offer_id", "sku", "total_minor", "equipment_json"}
        if not required.issubset(cols):
            errors.append("OFFER_SCHEMA_MISSING_REQUIRED_COLUMNS")
        else:
            bad_skus = 0
            bad_amounts = 0
            bad_metadata = 0
            for row in db.execute(
                "SELECT sku,total_minor,equipment_json FROM ops_manual_offers"
            ):
                sku, price, equipment = row
                if not isinstance(sku, str) or not sku.strip():
                    bad_skus += 1
                if not isinstance(price, int) or price <= 0:
                    bad_amounts += 1
                try:
                    value = json.loads(equipment or "{}")
                    if not isinstance(value, dict):
                        raise ValueError("Equipment metadata is not an object")
                    product = value.get("offerProduct")
                    if sku == "UTEN-VARENUMMER":
                        if not isinstance(product, dict) or not (
                            isinstance(product.get("name"), str) and product["name"].strip()
                        ):
                            bad_metadata += 1
                except (TypeError, ValueError):
                    bad_metadata += 1
            if bad_skus:
                errors.append(f"OFFER_BLANK_SKU:{bad_skus}")
            if bad_amounts:
                errors.append(f"OFFER_INVALID_TOTAL:{bad_amounts}")
            if bad_metadata:
                errors.append(f"OFFER_INVALID_PRODUCT_SNAPSHOT:{bad_metadata}")

    if "ops_manual_orders" in available:
        if "ops_manual_offers" not in available:
            errors.append("ORDERS_WITHOUT_OFFER_TABLE")
        else:
            # Check all material terms and provenance; acceptance must predate order.
            mismatches = db.execute("""
                SELECT COUNT(*) FROM ops_manual_orders ord
                LEFT JOIN ops_manual_offers offer ON offer.offer_id=ord.offer_id
                WHERE offer.offer_id IS NULL
                  OR offer.inquiry_id != ord.inquiry_id
                  OR offer.sku != ord.sku
                  OR offer.total_minor != ord.total_minor
                  OR offer.currency != ord.currency
                  OR offer.status != 'ACCEPTED'
                  OR offer.accepted_at IS NULL
            """).fetchone()[0]
            if mismatches:
                errors.append(f"ORDER_TERMS_OR_ACCEPTANCE_MISMATCH:{mismatches}")

        cols = set(columns(db, "ops_manual_orders"))
        if {"status", "payment_link_reference", "payment_link_sent_at"} <= cols:
            bad_payment = db.execute("""
                SELECT COUNT(*) FROM ops_manual_orders
                WHERE status IN ('PAYMENT_LINK_SENT','PAYMENT_VERIFIED_MANUALLY')
                  AND (payment_link_reference IS NULL OR payment_link_sent_at IS NULL)
            """).fetchone()[0]
            if bad_payment:
                errors.append(f"ORDER_PAYMENT_LINK_MISSING:{bad_payment}")

    return summary, errors


def compare(before: sqlite3.Connection, after: sqlite3.Connection) -> tuple[dict[str, Any], list[str]]:
    previous, current = tables(before), tables(after)
    errors: list[str] = []
    shared_table_count = 0
    for table in PROTECTED_TABLES:
        if table not in previous:
            continue
        if table not in current:
            errors.append("HISTORICAL_TABLE_REMOVED:" + table)
            continue
        old_cols = columns(before, table)
        new_cols = set(columns(after, table))
        missing = set(old_cols) - new_cols
        if missing:
            errors.append("HISTORICAL_COLUMNS_REMOVED:" + table)
            continue
        old_rows = table_fingerprint(before, table, old_cols)
        new_rows = table_fingerprint(after, table, old_cols)
        # New cases, events and offers may legitimately appear after release.
        # Preserve every historical row, including all original field values.
        missing_count = sum((old_rows - new_rows).values())
        if missing_count:
            errors.append(
                f"HISTORICAL_ROWS_CHANGED_OR_REMOVED:{table}:missing_or_modified={missing_count}"
            )
        shared_table_count += 1
    return {"historical_tables_checked": shared_table_count, "unchanged": not errors}, errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", required=True, type=Path, help="Offline pre-release SQLite export")
    parser.add_argument("--after", type=Path, help="Optional offline post-migration SQLite export")
    args = parser.parse_args(argv)
    if args.after and args.before.resolve() == args.after.resolve():
        print(json.dumps({"result": "NO_GO", "error_type": "ValueError",
                          "detail": "before and after must be distinct offline snapshots"}), file=sys.stderr)
        return 2
    try:
        with open_read_only(args.before) as before:
            previous, previous_errors = audit(before, "before")
            result: dict[str, Any] = {"before": previous}
            errors = previous_errors
            if args.after:
                with open_read_only(args.after) as after:
                    current, current_errors = audit(after, "after")
                    retention, retention_errors = compare(before, after)
                    result["after"] = current
                    result["retention"] = retention
                    errors += current_errors + retention_errors
            result["result"] = "NO_GO" if errors else "PASS"
            result["errors"] = sorted(set(errors))
            print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
            return 1 if errors else 0
    except (OSError, sqlite3.Error, ValueError) as exc:
        print(json.dumps({"result": "NO_GO", "error_type": type(exc).__name__,
                          "detail": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())