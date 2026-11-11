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


class HistoricalReleaseGuardTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.before = Path(self.t.name) / 'before.sqlite'
        self.after = Path(self.t.name) / 'after.sqlite'

    def run_guard(self):
        with contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()) as errors:
            code = guard.main(["--before", str(self.before), "--after", str(self.after)])
        return code, json.loads(output.getvalue() or errors.getvalue())

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

    def test_same_file_fails_closed(self):
        seed(self.before)
        self.after = self.before
        code, data = self.run_guard()
        self.assertEqual(code, 2)
        self.assertEqual(data['error_type'], 'ValueError')


if __name__ == "__main__":
    unittest.main()
