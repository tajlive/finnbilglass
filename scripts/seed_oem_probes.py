#!/usr/bin/env python3
"""
seed_oem_probes.py — Seed OEM probe queue med VIN-hash uten rå VIN i Git/DB-logg

Usage:
  python3 seed_oem_probes.py --pepper "$OEM_PROBE_PEPPER" --portal "Tesla Parts" --probes 10

VIN-er leveres via:
  - --vins-file <path> (en VIN per linje)
  - --vins-env <ENV_VAR_NAME> (komma-separert)
  - stdin (en VIN per linje)

Hvis ingen VIN-kilde gitt: bruker hardkodet stratifiserte Tesla VIN-er fra SVV-korpus
(for pilot kun — produksjon må hente fra SVV-eksport).
"""

import argparse, hashlib, json, os, sys, subprocess
from pathlib import Path

# Hardkodet pilot-VIN-er (fra SVV-korpus, kun for første pilot)
DEFAULT_VINS = [
    ("tesla-20250825-001", "XP7YGCEL0SB556587", "TESLA", "Model Y", 2025),
    ("tesla-20250825-002", "LRW3E7EC5MC390511", "TESLA", "Model 3", 2021),
    ("tesla-20250825-003", "XP7YGCEL1RB276252", "TESLA", "Model Y", 2023),
    ("tesla-20250825-004", "XP7YGCEL8PB111182", "TESLA", "Model Y", 2023),
    ("tesla-20250825-005", "XP7YGCEL7PB081057", "TESLA", "Model Y", 2023),
    ("tesla-20250825-006", "XP7YGCEL5PB149372", "TESLA", "Model Y", 2023),
    ("tesla-20250825-007", "LRW3E7EBXNC606068", "TESLA", "Model 3", 2022),
    ("tesla-20250825-008", "XP7YGCEK4PB044023", "TESLA", "Model Y", 2022),
    ("tesla-20250825-009", "LRWYGCEK5MC052090", "TESLA", "Model Y", 2021),
    ("tesla-20250825-010", "5YJ3E7EB7KF241740", "TESLA", "Model 3", 2019),
]

def hash_vin(vin: str, pepper: str) -> str:
    """SHA256(VIN || pepper)"""
    return hashlib.sha256((vin + pepper).encode()).hexdigest()

def parse_args():
    p = argparse.ArgumentParser(description="Seed oem_probe_queue with VIN hashes")
    p.add_argument("--pepper", required=True, help="Pepper for VIN hashing (32+ bytes hex)")
    p.add_argument("--portal", required=True, help="Portal name (e.g., 'Tesla Parts')")
    p.add_argument("--probes", type=int, default=10, help="Number of probes to seed")
    p.add_argument("--vins-file", help="File with VINs (one per line)")
    p.add_argument("--vins-env", help="Env var with comma-separated VINs")
    p.add_argument("--dry-run", action="store_true", help="Print SQL only")
    return p.parse_args()

def get_vins(args) -> list:
    """Return list of (probe_id, vin, make, model, year)"""
    if args.vins_file:
        with open(args.vins_file) as f:
            vins = [line.strip() for line in f if line.strip()]
        return [(f"{args.portal.lower().replace(' ', '-')}-{i:03d}", v, "", "", 0) for i, v in enumerate(vins, 1)]
    if args.vins_env:
        vins = os.environ.get(args.vins_env, "").split(",")
        return [(f"{args.portal.lower().replace(' ', '-')}-{i:03d}", v.strip(), "", "", 0) for i, v in enumerate(vins, 1) if v.strip()]
    # Default: pilot VINs
    return DEFAULT_VINS[:args.probes]

def main():
    args = parse_args()
    if len(args.pepper) < 32:
        print("ERROR: pepper must be at least 32 chars (hex)", file=sys.stderr)
        return 1

    probes = get_vins(args)
    if not probes:
        print("ERROR: No VINs provided", file=sys.stderr)
        return 1

    pepper = args.pepper
    portal = args.portal

    sql_statements = []
    for probe_id, vin, make, model, year in probes:
        vin_hash = hash_vin(vin, pepper)
        sql = f"""INSERT OR IGNORE INTO oem_probe_queue (probe_id, vin_hash, make, model, year, portal, status)
VALUES ('{probe_id}', '{vin_hash}', '{make}', '{model}', {year}, '{portal}', 'pending');"""
        sql_statements.append(sql)

    if args.dry_run:
        print("\n".join(sql_statements))
        return 0

    # Kjør via wrangler
    sql_block = "\n".join(sql_statements)
    try:
        result = subprocess.run(
            ["npx", "wrangler", "d1", "execute", "finnbilglass-db", "--remote", "--command", sql_block],
            capture_output=True, text=True, timeout=60, cwd="/Users/taj/finnbilglass"
        )
        if result.returncode != 0:
            print(f"ERROR: {result.stderr}", file=sys.stderr)
            return 1
        print(f"Seeded {len(probes)} probes for {portal}")
        return 0
    except subprocess.TimeoutExpired:
        print("ERROR: wrangler timeout", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())