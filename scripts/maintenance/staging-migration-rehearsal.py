#!/usr/bin/env python3
"""Offline, no-secrets D1/SQLite staging schema rehearsal. Never contacts Cloudflare.

Run from project root: python3 scripts/maintenance/staging-migration-rehearsal.py
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads(
    (ROOT / "scripts/maintenance/staging-fresh-db-manifest.json").read_text()
)
MIGRATIONS = MANIFEST["base"] + MANIFEST["ops"]
REQUIRED = set(MANIFEST["required_tables"]) | {
    "ops_mail_details", "ops_mail_events", "ops_work_events",
}
assert MANIFEST["database_name"] == "finnbilglass-db-staging"
assert MANIFEST["database_id"] == "78842e17-ab0b-47c1-acde-244044073466"
assert len(MANIFEST["ops"]) == 5


def rejects(db: sqlite3.Connection, query: str, params: tuple = ()) -> None:
    try:
        db.execute(query, params)
    except sqlite3.IntegrityError:
        return
    raise AssertionError(f"Expected D1/SQLite to reject: {query[:100]}")


def rehearsal() -> dict:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    # Rehearse THE SAME historical base + OPS files as remote bootstrap.
    # Uses a real inquiry schema, never a fake FK-only substitute.
    # No credentials and no Cloudflare calls.
    for path in MIGRATIONS:
        assert path.startswith("migrations/"), path
        assert ".." not in path, path
        sql = (ROOT / path).read_text(encoding="utf8")
        db.executescript(sql)
    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    assert REQUIRED <= tables, f"Missing tables: {REQUIRED - tables}"
    assert not list(db.execute("PRAGMA foreign_key_check"))
    db.execute(
        "INSERT INTO beta_inquiries(id,navn,kontakt) VALUES(?,?,?)",
        (1, "Staging synthetic", "staging-only@example.invalid"),
    )
    db.execute("""
      INSERT INTO beta_inquiry_events
      (event_id,inquiry_id,event_type,created_at,created_by)
      VALUES ('synthetic-reply',1,'reply',1100,'qa@example.invalid')
    """)
    db.execute("""
      INSERT INTO ops_manual_offers
      (offer_id,inquiry_id,version,sku,fitment_evidence_ref,equipment_json,
       total_minor,currency,delivery_note,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    """, ("offer-00000001", 1, 1, "GLASS-001", "evidence-1234567890", "{}",
          125000, "NOK", "Frakt avtales", "DRAFT", "qa@example.invalid", 1000))
    order_sql = """
      INSERT INTO ops_manual_orders
      (order_id,inquiry_id,offer_id,sku,total_minor,currency,created_at,
       created_by,status) VALUES(?,?,?,?,?,?,?,?,?)
    """
    order = ("order-00000001", 1, "offer-00000001", "GLASS-001",
             125000, "NOK", 1500, "qa@example.invalid", "ORDER_CREATED")
    # Never create an order directly from an unsent or unaccepted draft.
    rejects(db, order_sql, order)
    db.execute("""
      INSERT INTO ops_offer_outbox
      (offer_id,inquiry_id,request_id,recipient,subject,text_body,html_body,
       status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'QUEUED',?,?)
    """, ("offer-00000001", 1, "request-00000001", "staging-only@example.invalid",
          "Your offer", "Sample text", "<p>Sample text</p>", 1000, 1000))
    rejects(db, """
      INSERT INTO ops_offer_outbox
      (offer_id,inquiry_id,request_id,recipient,subject,text_body,html_body,
       status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'QUEUED',?,?)
    """, ("offer-00000001", 1, "request-00000002", "staging-only@example.invalid",
          "Your offer", "Sample text", "<p>Sample text</p>", 1001, 1001))
    db.execute("UPDATE ops_offer_outbox SET status='SENDING',updated_at=1100 WHERE offer_id='offer-00000001'")
    rejects(db, "UPDATE ops_offer_outbox SET recipient='attacker@example.invalid' WHERE offer_id='offer-00000001'")
    rejects(db, "UPDATE ops_offer_outbox SET status='SENT' WHERE offer_id='offer-00000001'")
    db.execute("UPDATE ops_offer_outbox SET status='SENT',provider_message_id='resend-test-id',updated_at=1200 WHERE offer_id='offer-00000001'")
    db.execute("UPDATE ops_manual_offers SET status='SENT',sent_at=1200 WHERE offer_id='offer-00000001'")
    rejects(db, order_sql, order)
    db.execute("""
      UPDATE ops_manual_offers SET status='ACCEPTED',accepted_at=1450,
      accepted_channel='EMAIL',acceptance_ref='synthetic-proof-123'
      WHERE offer_id='offer-00000001'
    """)
    db.execute(order_sql, order)
    rejects(db, order_sql, ("order-00000002", 1, "offer-00000001",
                             "GLASS-001", 125000, "NOK", 1550,
                             "qa@example.invalid", "ORDER_CREATED"))
    rejects(db, "UPDATE ops_manual_offers SET total_minor=1 WHERE offer_id='offer-00000001'")
    rejects(db, "UPDATE ops_manual_orders SET sku='CHANGED' WHERE order_id='order-00000001'")
    db.execute("""
      UPDATE ops_manual_orders
      SET status='PAYMENT_LINK_SENT',payment_link_reference='manual-sandbox-123',
          payment_link_sent_at=1800 WHERE order_id='order-00000001'
    """)
    rejects(db, "UPDATE ops_manual_orders SET status='ORDER_CREATED' WHERE order_id='order-00000001'")
    db.execute("""
      INSERT INTO ops_reply_outbox
      (request_id,inquiry_id,actor_email,recipient,body,status,created_at,updated_at)
      VALUES('response-00000000001',1,'qa@example.invalid',
             'staging-only@example.invalid','Sample','QUEUED',1000,1000)
    """)
    rejects(db, """
      UPDATE ops_reply_outbox SET status='SENT',provider_message_id=NULL,error=NULL
      WHERE request_id='response-00000000001'
    """)
    db.execute("""
      UPDATE ops_reply_outbox SET status='SENT',provider_message_id='resend-reply-id'
      WHERE request_id='response-00000000001'
    """)
    db.execute("""
      INSERT INTO ops_staff_activity(event_id,actor_email,action,subject_type,
                                     subject_id,created_at,details_json)
      VALUES('event-1','qa@example.invalid','OFFER_SENT','OFFER',
             'offer-00000001',1300,'{}')
    """)
    rejects(db, "UPDATE ops_staff_activity SET action='LOGIN' WHERE event_id='event-1'")
    rejects(db, "DELETE FROM ops_staff_activity WHERE event_id='event-1'")
    assert not list(db.execute("PRAGMA foreign_key_check"))
    # CREATE IF NOT EXISTS should be safe if an interrupted migration is rerun.
    for path in MANIFEST["ops"]:
        sql = (ROOT / path).read_text(encoding="utf8")
        db.executescript(sql)
    assert db.execute("SELECT COUNT(*) FROM ops_manual_orders").fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM ops_offer_outbox").fetchone()[0] == 1
    return {
        "status": "PASS", "migration_files": len(MIGRATIONS), "base_files": len(MANIFEST["base"]),
        "required_tables": len(REQUIRED),
        "foreign_key_check": "PASS", "offer_duplicate": "BLOCKED",
        "order_without_acceptance": "BLOCKED", "immutable_terms": "PASS",
        "resend_without_id": "BLOCKED", "staff_audit": "IMMUTABLE",
        "reapply": "PASS", "remote_db_access": False
    }


if __name__ == "__main__":
    print(json.dumps(rehearsal(), sort_keys=True))
