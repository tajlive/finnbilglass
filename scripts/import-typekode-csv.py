#!/usr/bin/env python3
"""
Import av typekoder (glassplassering) fra auto-glass.no-katalogen.

Kilde: products-autoglass-no.csv — felt `sku`, `type_code`, `type_code_desc`.
Kjøres mot én D1-database om gangen, i idempotente batcher.

  dry-run (standard):
    ./.venv-inventory/bin/python scripts/import-typekode-csv.py --db finnbilglass-staging-catalog --remote

  faktisk import:
    ... --apply

Sikkerhet:
  - Kun INSERT/REPLACE i den nye tabellen glass_typekode.
  - Rører ikke glass_prisliste, priser eller andre tabeller.
  - Rapporterer konflikter (samme varenr med ulik typekode i kilden) i stedet
    for å velge stille.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

KILDE = Path("/Users/taj/bilglass/data/autoglass-scrape/products-autoglass-no.csv")
BATCH = 800


def les_koder() -> tuple[dict[str, tuple[str, str]], dict[str, set[str]]]:
    """Returnerer (varenr → (typekode, beskrivelse)) og konflikter (varenr → sett av koder)."""
    koder: dict[str, tuple[str, str]] = {}
    alle: dict[str, set[str]] = defaultdict(set)
    with KILDE.open(encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            sku = (r.get("sku") or "").strip().upper()
            kode = (r.get("type_code") or "").strip().upper()
            if not sku or not kode:
                continue
            alle[sku].add(kode)
            if sku not in koder:
                koder[sku] = (kode, (r.get("type_code_desc") or "").strip()[:80])
    konflikter = {k: v for k, v in alle.items() if len(v) > 1}
    # Ved konflikt: behold første, men rapporter
    return koder, konflikter


def d1(sql: str, db: str, remote: bool) -> str:
    cmd = ["npx", "wrangler", "d1", "execute", db, "--json", "--command", sql]
    if remote:
        cmd.insert(5, "--remote")
    p = subprocess.run(cmd, cwd="/Users/taj/finnbilglass", capture_output=True, text=True, timeout=300)
    if p.returncode != 0:
        raise RuntimeError((p.stdout + p.stderr)[:400])
    return p.stdout


def hoved() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if not KILDE.exists():
        print(f"FEIL: kilden finnes ikke: {KILDE}")
        return 2

    koder, konflikter = les_koder()
    print(f"kilde: {KILDE.name}")
    print(f"unike varenr med typekode: {len(koder)}")
    print(f"konflikter i kilden (samme varenr, ulik kode): {len(konflikter)}")
    for k, v in list(konflikter.items())[:5]:
        print(f"   {k}: {sorted(v)}")

    naa = int(time.time() * 1000)
    sql_rader = []
    for sku, (kode, beskrivelse) in koder.items():
        b = beskrivelse.replace("'", "''")
        sql_rader.append(
            f"('{sku}','{kode}','{b}','autoglass-no','{KILDE.name}',{naa})"
        )

    print(f"batch: {BATCH} rader per kommando, {len(sql_rader)} rader totalt")
    if not args.apply:
        print("\nDRY-RUN — ingenting skrevet. Eksempel på SQL:")
        print("  INSERT OR REPLACE INTO glass_typekode (varenr,typekode,typekode_beskrivelse,kilde,kildefil,hentet_at) VALUES")
        print("   " + sql_rader[0] + ", ...")
        return 0

    skrevet = 0
    for i in range(0, len(sql_rader), BATCH):
        del_ = ", ".join(sql_rader[i:i + BATCH])
        sql = (
            "INSERT OR REPLACE INTO glass_typekode "
            "(varenr,typekode,typekode_beskrivelse,kilde,kildefil,hentet_at) VALUES " + del_ + ";"
        )
        d1(sql, args.db, args.remote)
        skrevet += len(sql_rader[i:i + BATCH])
        print(f"  skrevet {skrevet}/{len(sql_rader)}", flush=True)

    print("\nverifisering:")
    print(d1("SELECT COUNT(*) n, COUNT(DISTINCT typekode) koder FROM glass_typekode", args.db, args.remote)[:200])
    return 0


if __name__ == "__main__":
    raise SystemExit(hoved())
