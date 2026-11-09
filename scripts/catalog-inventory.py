#!/usr/bin/env python3
"""
Kildeinventar for FinnBilGlass (V6.0, fase 1).

Leser originale datafiler (XLS/XLSX/CSV/TSV) og lager:
  - docs/excel-source-inventory.md   (menneskelesbar)
  - data/catalog-source-inventory.json (maskinlesbar)

Prinsipper:
  - Kun lesing. Ingen filer endres eller slettes.
  - Registrerer faktisk filnavn og plassering — aldri påstand om filer som ikke finnes.
  - Duplikater oppdages med SHA-256.
  - Kolonner klassifiseres etter hva de faktisk inneholder (posisjon, kjøretøy,
    identitet, utstyr, kommersielt), med nøkkelord på norsk og engelsk.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOTS = [
    Path("/Users/taj/finnbilglass"),
    Path("/Users/taj/bilglass"),
    Path("/Users/taj/Downloads"),
]
EXTS = {".xls", ".xlsx", ".xlsm", ".xlsb", ".csv", ".tsv"}
SKIP_DIRS = {"node_modules", ".git", ".venv-inventory", "venv", "allure-report", ".next", "dist"}

# Klassifisering av kolonnenavn → hva slags informasjon filen gir
KLASSER = {
    "identitet": ["varenr", "sku", "article", "artikkel", "eurocode", "eurokode", "oe", "oem", "produsentnummer", "part", "alias", "erstatning", "supersession"],
    "kjoretoy": ["make", "merke", "model", "modell", "year", "aar", "år", "generation", "karosseri", "body", "vin", "ktype", "tecdo", "engine", "motor"],
    "posisjon": ["position", "posisjon", "plassering", "typekode", "type", "dør", "dor", "door", "side", "ledd", "front", "rear", "bak", "ventil", "tak", "roof"],
    "utstyr": ["kamera", "camera", "sensor", "rain", "regn", "hud", "heated", "oppvarm", "acoustic", "akustisk", "antenna", "antenne", "adas", "lane", "shade", "solskjerm", "toning", "tint"],
    "kommersielt": ["pris", "price", "cost", "kost", "lager", "stock", "valuta", "currency", "mva", "vat", "levering", "delivery"],
}

def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def klassifiser(headers: list[str]) -> dict[str, bool]:
    low = " | ".join(h.lower() for h in headers if h)
    return {k: any(w in low for w in words) for k, words in KLASSER.items()}

def les_csv(p: Path, maks_rader: int = 5000) -> dict:
    """Teller ALLE rader, men samler unikhet kun fra de første for hastighet."""
    with p.open("rb") as f:
        raaka = f.read(64 * 1024)
    tekst = raaka.decode("utf-8", errors="replace")
    try:
        dialekt = csv.Sniffer().sniff(tekst[:4096], delimiters=",;\t|")
        delim = dialekt.delimiter
    except Exception:
        delim = ";" if tekst.count(";") > tekst.count(",") else ","

    total_linjer = 0
    with p.open("rb") as fb:
        for blokk in iter(lambda: fb.read(1024 * 1024), b""):
            total_linjer += blokk.count(b"\n")
    with p.open("r", encoding="utf-8", errors="replace", newline="") as f:
        leser = csv.reader(f, delimiter=delim)
        headers = next(leser, [])
        rader = 0
        tomme = 0
        unike: dict[str, set] = {}
        for i, rad in enumerate(leser):
            rader += 1
            if not any(c.strip() for c in rad):
                tomme += 1
            if i < 3000:
                for j, verdi in enumerate(rad[:len(headers)]):
                    if j < 8 and verdi.strip():
                        unike.setdefault(str(j), set()).add(verdi.strip()[:60])
            if rader >= maks_rader:
                break
    return {
        "format": "csv",
        "skilletegn": delim,
        "ark": [{"navn": "(eneste)", "rader": rader, "kolonner": len(headers)}],
        "headers": headers,
        "rader_lest": rader,
        "rader_totalt": max(0, total_linjer - 1),
        "avkortet": rader >= maks_rader,
        "tomme_rader": tomme,
        "unike_eksempel": {headers[int(k)] if int(k) < len(headers) else k: len(v) for k, v in unike.items()},
    }

def les_xlsx(p: Path) -> dict:
    from openpyxl import load_workbook
    wb = load_workbook(p, read_only=True, data_only=True)
    ark = []
    for navn in wb.sheetnames:
        ws = wb[navn]
        ark.append({"navn": navn, "rader": ws.max_row or 0, "kolonner": ws.max_column or 0, "skjult": bool(getattr(ws, "sheet_state", "visible") != "visible")})
    headers: list[str] = []
    if wb.sheetnames:
        ws = wb[wb.sheetnames[0]]
        for i, rad in enumerate(ws.iter_rows(max_row=8, values_only=True)):
            verdier = [str(c).strip() for c in (rad or []) if c is not None and str(c).strip()]
            if len(verdier) >= 3:
                headers = [str(c).strip() if c is not None else "" for c in rad]
                break
    wb.close()
    return {"format": "xlsx", "ark": ark, "headers": headers}

def les_xls(p: Path) -> dict:
    import xlrd
    bok = xlrd.open_workbook(str(p), on_demand=True)
    ark = [{"navn": n, "rader": bok.sheet_by_name(n).nrows, "kolonner": bok.sheet_by_name(n).ncols, "skjult": False} for n in bok.sheet_names()]
    headers: list[str] = []
    if bok.sheet_names():
        s = bok.sheet_by_index(0)
        for r in range(min(8, s.nrows)):
            verdier = [str(v).strip() for v in s.row_values(r) if str(v).strip()]
            if len(verdier) >= 3:
                headers = [str(v).strip() for v in s.row_values(r)]
                break
    bok.release_resources()
    return {"format": "xls", "ark": ark, "headers": headers}

SENSITIVE = ["passord", "password", "secret", "token", "credential", "nøkkel", "key"]
IRRELEVANT = ["klarpakke", "allure", "behaviors", "suites", "categories"]

def relevans(info: dict) -> str:
    navn = info["fil"].lower()
    if any(w in navn for w in SENSITIVE):
        return "SENSITIV — ekskluderes"
    if any(w in navn for w in IRRELEVANT):
        return "ikke relevant"
    k = info.get("klasser") or {}
    if k.get("identitet") and (k.get("kjoretoy") or k.get("posisjon")):
        return "kjernedata"
    if k.get("identitet") or k.get("posisjon"):
        return "glassrelevant"
    if k.get("kommersielt"):
        return "prisdata"
    return "uklar"

def main() -> int:
    funnet = []
    for rot in ROOTS:
        if not rot.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(rot):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            # hopp over worktrees-dubletter i dybden
            if "/.worktrees/" in dirpath:
                continue
            for fn in filenames:
                p = Path(dirpath) / fn
                if p.suffix.lower() not in EXTS:
                    continue
                if p.stat().st_size == 0:
                    continue
                funnet.append(p)

    sett: dict[str, dict] = {}
    for p in sorted(funnet):
        try:
            st = p.stat()
            digest = sha256(p)
        except Exception as e:
            print(f"  hoppet over {p}: {e}", file=sys.stderr)
            continue
        if digest in sett:
            sett[digest]["duplikater"].append(str(p))
            continue
        info = {
            "fil": p.name,
            "sti": str(p),
            "format": p.suffix.lower().lstrip("."),
            "bytes": st.st_size,
            "endret": datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%Y-%m-%d"),
            "sha256": digest,
            "duplikater": [],
        }
        try:
            if p.suffix.lower() in (".csv", ".tsv"):
                info.update(les_csv(p))
            elif p.suffix.lower() in (".xlsx", ".xlsm"):
                info.update(les_xlsx(p))
            elif p.suffix.lower() == ".xls":
                info.update(les_xls(p))
            else:
                info.update({"format": p.suffix.lower().lstrip("."), "ark": [], "headers": []})
        except Exception as e:
            info["feil"] = f"{type(e).__name__}: {e}"
            info.setdefault("ark", [])
            info.setdefault("headers", [])
        info["klasser"] = klassifiser(info.get("headers") or [])
        info["relevans"] = relevans(info)
        sett[digest] = info

    inventar = list(sett.values())
    out = Path("/Users/taj/finnbilglass")
    (out / "data").mkdir(exist_ok=True)
    (out / "docs").mkdir(exist_ok=True)
    (out / "data" / "catalog-source-inventory.json").write_text(json.dumps(inventar, ensure_ascii=False, indent=1), encoding="utf-8")

    linjer = [
        "# Kildeinventar — originale datafiler",
        "",
        f"Generert {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} av `scripts/catalog-inventory.py`.",
        "Kun lesing — ingen filer er endret. Duplikater er slått sammen på SHA-256.",
        "",
        "| Fil | Relevans | Format | Størrelse | Rader | Ark | Identitet | Kjøretøy | Posisjon | Utstyr | Kommersielt |",
        "|---|---|---|---:|---:|---:|---|---|---|---|---|",
    ]
    def ja(b): return "ja" if b else "–"
    for i in sorted(inventar, key=lambda x: -x["bytes"]):
        rader = i.get("rader_totalt") or sum(a.get("rader", 0) or 0 for a in i.get("ark", []))
        linjer.append(
            f"| `{i['fil']}` | {i.get('relevans','?')} | {i['format']} | {i['bytes']//1024} kB | {rader} | {len(i.get('ark', []))} | "
            f"{ja(i['klasser']['identitet'])} | {ja(i['klasser']['kjoretoy'])} | {ja(i['klasser']['posisjon'])} | "
            f"{ja(i['klasser']['utstyr'])} | {ja(i['klasser']['kommersielt'])} |"
        )
    with (out / "docs" / "excel-source-inventory.md").open("w", encoding="utf-8") as f:
        f.write("\n".join(linjer) + "\n")
    print(f"inventar: {len(inventar)} unike filer, {sum(len(i['duplikater']) for i in inventar)} duplikater")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
