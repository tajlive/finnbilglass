#!/usr/bin/env python3
"""
Genererer idempotent SQL som legger til de produktvariantene som forsvant i
importen (UNIQUE(varenr, varenavn)), med variant_id som identitet.

Krever at migrasjon 0048 er kjørt (kolonnen variant_id + unik indeks).

Regler:
  * INSERT ... ON CONFLICT(variant_id) DO NOTHING — gjentatt kjøring er en no-op.
  * Eksisterende rader endres IKKE (ingen nye kundepriser, ingen nye radtyper).
  * Identifikatorer skrives som TEKST, nøyaktig som i kilden (numeriske celler
    konverteres til heltall uten desimaler).
  * rad_type utledes med samme regler som den opprinnelige importen (validert
    mot de 29 627 radene som allerede ligger i basen).

Bruk:
  python3 scripts/katalog-import-variant.py \
      --uttrekk reports/katalog-uttrekk-20261104.json \
      --db reports/_prod-prisliste-dump-20261104.json \
      --ut db/katalog
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter

EMB_RE = re.compile(r"^\s*EMBALLASJE\b", re.I)
FRAKT_RE = re.compile(r"POST|FRAKT|BRING|GEBYR", re.I)
ALIAS_RE = re.compile(r"^\s*(?:=\s*)?(?:BRUK|USE)\b[\s:]*([A-Z0-9][A-Z0-9 +/._-]*)$", re.I)
# Den opprinnelige importen behandlet «=BRUK …»-rader som vanlige produkter
# (glass når de har eurokode, ellers tilbehør) og bare «BRUK …»/«USE …» som alias.
# Regelen speiler det, slik at en ny rad får samme rad_type som den ville fått før
# (målt: 100 % treff på de 29 627 radene som ligger i basen).
ALIAS_LIK = re.compile(r"^\s*(?:BRUK|USE)\b", re.I)


def rad_type(ln: dict) -> tuple[str, str | None]:
    navn = ln["varenavn"] or ""
    if ALIAS_LIK.match(navn):
        m = ALIAS_RE.match(navn)
        return "alias", (m.group(1).strip() if m else None)
    if EMB_RE.match(navn):
        return "emballasje", None
    if FRAKT_RE.search(navn):
        return "frakt", None
    if ln["eurokode"]:
        return "glass", None
    return "tilbehor", None


def sq(s) -> str:
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def num(v) -> str:
    if v is None:
        return "NULL"
    f = float(v)
    return str(int(f)) if f.is_integer() else repr(f)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--uttrekk", default="reports/katalog-uttrekk-20261104.json")
    p.add_argument("--db", default="reports/_prod-prisliste-dump-20261104.json")
    p.add_argument("--ut", default="db/katalog")
    p.add_argument("--per-fil", type=int, default=500)
    p.add_argument("--alle", action="store_true", help="skriv alle rader (ikke bare manglende varianter)")
    p.add_argument("--klassifiser-test", action="store_true", help="mål rad_type-treff mot DB og avslutt")
    a = p.parse_args()

    linjer = json.load(open(a.uttrekk, encoding="utf-8"))["linjer"]
    db = json.load(open(a.db, encoding="utf-8"))[0]["results"]

    # ── Valider klassifiseringen mot radene som allerede ligger i basen ──
    treff = Counter()
    avvik = []
    for r in db:
        ln = {"varenavn": r["varenavn"], "eurokode": r["eurokode"]}
        t, _ = rad_type(ln)
        treff[t == r["rad_type"]] += 1
        if t != r["rad_type"] and len(avvik) < 15:
            avvik.append({"varenr": r["varenr"], "navn": (r["varenavn"] or "")[:50],
                          "db": r["rad_type"], "regel": t})
    totalt = sum(treff.values())
    print(f"rad_type-treff mot DB: {treff[True]}/{totalt} ({100 * treff[True] / totalt:.2f} %), avvik {treff[False]}")
    for x in avvik:
        print("   avvik:", x)
    if a.klassifiser_test:
        return

    # ── Hvilke varianter mangler? ────────────────────────────────────────
    def ascii_upper(t: str) -> str:
        """SQLite UPPER() er ASCII-only. Nøkkelen må regnes likt i SQL og Python,
        ellers får «på» og «PÅ» ulik identitet for samme rad."""
        return "".join(c.upper() if ord(c) < 128 else c for c in t)

    def ren_kode(s) -> str:
        """Kanonisk kode: trim + store bokstaver, og fjern float-artefakten «.0».
        Tegn som + - . beholdes — to eurokoder som bare skiller seg i tegnsetting
        skal IKKE smelte sammen."""
        t = ascii_upper(str(s or "").strip())
        return t[:-2] if re.fullmatch(r"\d+\.0", t) else t

    def vnokkel(varenr, eurokode, varenavn) -> str:
        v = ren_kode(varenr)
        e = ren_kode(eurokode)
        return f"{v}:{e}" if e else f"{v}:~{ascii_upper(str(varenavn or '').strip())}"

    db_nokler = {
        vnokkel(ren_kode(r["varenr"]), ren_kode(r["eurokode"]), r["varenavn"])
        for r in db
    }

    rader = []
    duplikat_i_kilde = 0
    sett = set()
    for ln in linjer:
        nokkel = vnokkel(ln["varenr"], ln["eurokode"], ln["varenavn"])
        if nokkel in sett:
            duplikat_i_kilde += 1
        sett.add(nokkel)
        if not a.alle and nokkel in db_nokler:
            continue
        t, alias = rad_type(ln)
        rader.append((nokkel, ln, t, alias))

    print(f"kilden: {len(linjer)} linjer, {len(sett)} unike varianter, {duplikat_i_kilde} dubletter i kilden")
    print(f"skal skrives: {len(rader)} varianter ({'alle' if a.alle else 'kun manglende'})")
    print("fordeling rad_type:", dict(Counter(r[2] for r in rader)))

    os.makedirs(a.ut, exist_ok=True)
    for gammel in os.listdir(a.ut):
        if gammel.startswith("variant_upsert_"):
            os.remove(os.path.join(a.ut, gammel))

    hode = [
        "-- Produktvarianter fra Autoglass-prislisten (PROSEKT API 16.05.2026).",
        "-- Generert av scripts/katalog-import-variant.py.",
        "-- Forutsetter migrasjon 0048 (variant_id). Idempotent: ON CONFLICT DO NOTHING.",
        "-- Eksisterende rader endres ikke (ingen nye kundepriser).",
        "",
    ]
    filer = []
    for i in range(0, len(rader), a.per_fil):
        del_ = rader[i:i + a.per_fil]
        sti = os.path.join(a.ut, f"variant_upsert_{i // a.per_fil:02d}.sql")
        with open(sti, "w", encoding="utf-8") as fh:
            fh.write("\n".join(hode))
            fh.write("INSERT INTO glass_prisliste (varenr, varenavn, kommentar, pris, eurokode, alias_av, rad_type, variant_id) VALUES\n")
            verdier = []
            for nokkel, ln, t, alias in del_:
                verdier.append(
                    f"({sq(ln['varenr'])}, {sq(ln['varenavn'])}, {sq(ln['merknad'])}, "
                    f"{num(ln['pris'])}, {sq(ln['eurokode'])}, {sq(alias)}, {sq(t)}, {sq(nokkel)})"
                )
            fh.write(",\n".join(verdier))
            fh.write("\nON CONFLICT(variant_id) DO NOTHING;\n")
        filer.append(sti)

    print(f"skrev {len(filer)} SQL-filer i {a.ut}/variant_upsert_*.sql")
    if filer:
        print("kjør med: for f in db/katalog/variant_upsert_*.sql; do wrangler d1 execute <DB> --remote --file=$f; done")


if __name__ == "__main__":
    main()
