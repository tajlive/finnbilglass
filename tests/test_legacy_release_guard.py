"""Offline, synthetic regression tests for historical OPS snapshots (no Cloudflare)."""
import contextlib
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "maintenance"))
import legacy_jobs_release_guard as guard


def seed(path, *, change=None, add_case=False, offers=False, broken_offer=False):
    with sqlite3.connect(path) as db:
        db.executescript("""
            PRAGMA foreign_keys = ON;
            CREATE TABLE beta_inquiries(id INTEGER PRIMARY KEY, navn TEXT, status TEXT);
            CREATE TABLE beta_inquiry_events(event_id TEXT PRIMARY KEY, inquiry_id INTEGER REFERENCES beta_inquiries(id), event_type TEXT);
        """)
        db.execute("INSERT INTO beta_inquiries VALUES (1, 'Synthetic old case', 'NEW')")
        db.execute("INSERT INTO beta_inquiry_events VALUES ('e1', 1, 'created')")
        if change == "delete":
            db.execute("DELETE FROM beta_inquiry_events WHERE event_id='e1'")
        elif change == "mutate":
            db.execute("UPDATE beta_inquiries SET status='CLOSED' WHERE id=1")
        elif change == "drop_table":
            db.execute("DROP TABLE beta_inquiry_events")
        if add_case:
            db.execute("INSERT INTO beta_inquiries VALUES (2, 'Synthetic new case', 'NEW')")
            db.execute("INSERT INTO beta_inquiry_events VALUES ('e2', 2, 'created')")
        if offers:
            db.executescript("""
                CREATE TABLE ops_manual_offers (
                  offer_id TEXT PRIMARY KEY, inquiry_id INTEGER REFERENCES beta_inquiries(id),
                  sku TEXT, total_minor INTEGER, equipment_json TEXT, currency TEXT,
                  status TEXT, accepted_at INTEGER);
                CREATE TABLE ops_manual_orders (
                  order_id TEXT PRIMARY KEY, offer_id TEXT REFERENCES ops_manual_offers(offer_id),
                  inquiry_id INTEGER REFERENCES beta_inquiries(id),
                  sku TEXT, total_minor INTEGER, currency TEXT);
            """)
            metadata = '{"offerProduct":{"name":"Synthetic sample glass","partNumber":null}}'
            if broken_offer:
                metadata = '{}'
            db.execute("INSERT INTO ops_manual_offers VALUES (?, 1, ?, 159900, ?, 'NOK', 'ACCEPTED', 2000)",
                       ('offer-1', 'UTEN-VARENUMMER', metadata))
            db.execute("INSERT INTO ops_manual_orders VALUES ('order-1','offer-1',1,'UTEN-VARENUMMER',159900,'NOK')")


def seed_extended(path, *, missing_message=False, missing_image=False):
    seed(path)
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript("""
            CREATE TABLE ops_messages (
              id TEXT PRIMARY KEY,
              inquiry_id INTEGER REFERENCES beta_inquiries(id),
              message TEXT);
            CREATE TABLE evidence_cases (
              case_id TEXT PRIMARY KEY, status TEXT);
            CREATE TABLE evidence_case_images (
              image_id TEXT PRIMARY KEY, case_id TEXT REFERENCES evidence_cases(case_id),
              r2_key TEXT NOT NULL, thumb_r2_key TEXT);
            CREATE TABLE evidence_case_review_events (
              event_id TEXT PRIMARY KEY, case_id TEXT REFERENCES evidence_cases(case_id),
              status TEXT);
        """)
        db.execute("INSERT INTO ops_messages VALUES ('msg-1',1,'Synthetic message')")
        db.execute("INSERT INTO evidence_cases VALUES ('case-1','NEW')")
        db.execute(
            "INSERT INTO evidence_case_images VALUES "
            "('img-1','case-1','case-1/photo.jpg','case-1/thumb.jpg')"
        )
        db.execute("INSERT INTO evidence_case_review_events VALUES ('ev-1','case-1','NEW')")
        if missing_message:
            db.execute("DELETE FROM ops_messages WHERE id='msg-1'")
        if missing_image:
            db.execute("DELETE FROM evidence_case_images WHERE image_id='img-1'")


class HistoricalReleaseGuardTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.before = Path(self.t.name) / 'before.sqlite'
        self.after = Path(self.t.name) / 'after.sqlite'

    def run_guard(self, extra_args=None):
        args = ["--before", str(self.before), "--after", str(self.after)]
        args.extend(extra_args or [])
        with contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()) as errors:
            code = guard.main(args)
        return code, json.loads(output.getvalue() or errors.getvalue())

    def r2_inventories(self, *, after_keys="case-1/photo.jpg\\ncase-1/thumb.jpg\\n"):
        before_keys = Path(self.t.name) / "r2-before.txt"
        after_keys_file = Path(self.t.name) / "r2-after.txt"
        before_keys.write_text("case-1/photo.jpg\\ncase-1/thumb.jpg\\n".replace("\\\\n", "\\n"), encoding="utf-8")
        after_keys_file.write_text(after_keys.replace("\\\\n", "\\n"), encoding="utf-8")
        return ["--r2-inventory-before", str(before_keys),
                "--r2-inventory-after", str(after_keys_file)]

    def test_new_cases_and_events_are_allowed(self):
        seed(self.before)
        seed(self.after, add_case=True)
        code, data = self.run_guard()
        self.assertEqual(code, 0, data)
        self.assertEqual(data['retention']['historical_tables_checked'], 2)

    def test_deletion_is_rejected(self):
        seed(self.before)
        seed(self.after, change='delete')
        code, data = self.run_guard()
        self.assertEqual(code, 1)
        self.assertTrue(any('HISTORICAL_ROWS_CHANGED_OR_REMOVED:beta_inquiry_events' in x for x in data['errors']))

    def test_old_status_change_is_rejected(self):
        seed(self.before)
        seed(self.after, change='mutate')
        code, data = self.run_guard()
        self.assertEqual(code, 1)
        self.assertTrue(any('HISTORICAL_ROWS_CHANGED_OR_REMOVED:beta_inquiries' in x for x in data['errors']))

    def test_historical_table_removal_is_rejected(self):
        seed(self.before)
        seed(self.after, change='drop_table')
        code, data = self.run_guard()
        self.assertEqual(code, 1)
        self.assertTrue(any('HISTORICAL_TABLE_REMOVED' in x for x in data['errors']))

    def test_accepted_name_only_offer_order_survives(self):
        seed(self.before, offers=True)
        seed(self.after, offers=True, add_case=True)
        code, data = self.run_guard()
        self.assertEqual(code, 0, data)
        self.assertEqual(data['before']['tables']['ops_manual_orders'], 1)

    def test_name_only_offer_requires_snapshot(self):
        seed(self.before, offers=True)
        seed(self.after, offers=True, broken_offer=True)
        code, data = self.run_guard()
        self.assertEqual(code, 1)
        self.assertTrue(any('OFFER_INVALID_PRODUCT_SNAPSHOT' in x for x in data['errors']))

    def test_deleted_customer_mail_is_rejected(self):
        seed_extended(self.before)
        seed_extended(self.after, missing_message=True)
        code, data = self.run_guard(self.r2_inventories())
        self.assertEqual(code, 1)
        self.assertTrue(any("HISTORICAL_ROWS_CHANGED_OR_REMOVED:ops_messages" in x
                            for x in data["errors"]), data)

    def test_deleted_image_reference_is_rejected(self):
        seed_extended(self.before)
        seed_extended(self.after, missing_image=True)
        code, data = self.run_guard(self.r2_inventories())
        self.assertEqual(code, 1)
        self.assertTrue(any("HISTORICAL_ROWS_CHANGED_OR_REMOVED:evidence_case_images" in x
                            for x in data["errors"]), data)

    def test_missing_image_object_is_rejected(self):
        seed_extended(self.before)
        seed_extended(self.after)
        code, data = self.run_guard(
            self.r2_inventories(after_keys="case-1/photo.jpg\\n"))
        self.assertEqual(code, 1)
        self.assertTrue(any("R2_MISSING_OBJECT_REFERENCES" in x
                            for x in data["errors"]), data)

    def test_r2_inventory_required_if_images_exist(self):
        seed_extended(self.before)
        seed_extended(self.after)
        code, data = self.run_guard()
        self.assertEqual(code, 1)
        self.assertIn("R2_INVENTORY_REQUIRED", data["errors"])

    def test_matching_message_image_evidence_and_r2_pass(self):
        seed_extended(self.before)
        seed_extended(self.after)
        code, data = self.run_guard(self.r2_inventories())
        self.assertEqual(code, 0, data)
        self.assertEqual(data["result"], "PASS")
        self.assertIn("evidence_case_review_events", data["before"]["tables"])

    def test_same_file_fails_closed(self):
        seed(self.before)
        self.after = self.before
        code, data = self.run_guard()
        self.assertEqual(code, 2)
        self.assertEqual(data['error_type'], 'ValueError')


if __name__ == "__main__":
    unittest.main()
