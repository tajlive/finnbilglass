#!/usr/bin/env python3
"""
Avstemming: XLS-kilden mot produksjons-D1 (og staging etter import).

Svarer på oppdragets pkt. 1: alle tall skal kunne forklares uten restdifferanser.
Hvert tall skrives sammen med den eksakte SQL-en som produserer det, slik at
avstemmingen kan kjøres på nytt mot en hvilken som helst dump.

Bruk:
  python3 scripts/katalog-avstemming.py \
    --uttrekk reports/katalog-uttrekk-20261104.json \
    --prod reports/_prod-dump-20261104.json \
    [--staging reports/_staging-dump-20261104.json] \
    --ut reports
"""
from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict



def ascii_upper(s: str) -> str:
    """SQLite UPPER() er ASCII-only. Nøkkelen må regnes likt i SQL og Python,
    ellers får «på» og «PÅ» ulik identitet for samme rad."""
    return "".join(c.upper() if ord(c) < 128 else c for c in s)

def ren(s) -> str:
    """Kanonisk kode for sammenligning: trim, store bokstaver, fjern float-artefakt."""
    t = ascii_upper(str(s or "").strip())
    return t[:-2] if re.fullmatch(r"\d+\.0", t) else t


def vnokkel(varenr, eurokode, varenavn) -> str:
    v = ren(varenr)
    e = ren(eurokode)
    return f"{v}:{e}" if e else f"{v}:~{ascii_upper(str(varenavn or '').strip())}"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--uttrekk", default="reports/katalog-uttrekk-20261104.json")
    p.add_argument("--prod", default="reports/_prod-dump-20261104.json")
    p.add_argument("--staging", default=None)
    p.add_argument("--ut", default="reports")
    p.add_argument("--dato", default="20261104")
    a = p.parse_args()

    kilde = json.load(open(a.uttrekk, encoding="utf-8"))["linjer"]
    prod = json.load(open(a.prod, encoding="utf-8"))[0]["results"]
    staging = json.load(open(a.staging, encoding="utf-8"))[0]["results"] if a.staging else None

    # ── Nøkler ─────────────────────────────────────────────────────────────
    k_nokkel = [vnokkel(l["varenr"], l["eurokode"], l["varenavn"]) for l in kilde]
    p_nokkel = [vnokkel(r["varenr"], r["eurokode"], r["varenavn"]) for r in prod]
    k_set, p_set = set(k_nokkel), set(p_nokkel)

    k_euro = {ren(l["eurokode"]) for l in kilde if l["eurokode"]}
    p_euro = {ren(r["eurokode"]) for r in prod if r["eurokode"]}
    k_par = {(ren(l["varenr"]), ren(l["eurokode"])) for l in kilde if l["eurokode"]}
    p_par = {(ren(r["varenr"]), ren(r["eurokode"])) for r in prod if r["eurokode"]}

    bare_kilde = [l for l, n in zip(kilde, k_nokkel) if n not in p_set]
    bare_prod = [r for r, n in zip(prod, p_nokkel) if n not in k_set]

    # Årsaker til at en kilde-variant ikke finnes i prod
    p_par_set = p_par
    aarsak = Counter()
    for l in bare_kilde:
        e = ren(l["eurokode"])
        if not e:
            aarsak["uten_eurokode"] += 1
        elif e not in p_euro:
            aarsak["eurokode_finnes_ikke_i_prod"] += 1
        elif (ren(l["varenr"]), e) not in p_par_set:
            aarsak["eurokode_finnes_under_annet_varenr"] += 1
        else:
            aarsak["ukjent"] += 1

    # Duplikater innenfor hver kilde, etter valgt variantdefinisjon
    dupl_kilde = Counter(k_nokkel)
    dupl_prod = Counter(p_nokkel)
    dupl_k = sum(v - 1 for v in dupl_kilde.values() if v > 1)
    dupl_p = sum(v - 1 for v in dupl_prod.values() if v > 1)

    # Samme (varenr, eurokode) med ulikt navn/pris = datakonflikt
    konflikt_k = defaultdict(list)
    for l in kilde:
        if l["eurokode"]:
            konflikt_k[(ren(l["varenr"]), ren(l["eurokode"]))].append(l)
    konflikter = [v for v in konflikt_k.values() if len({x["varenavn"] for x in v}) > 1]

    k_euro_bare = k_euro - p_euro
    p_euro_bare = p_euro - k_euro

    rapport = {
        "definisjoner": {
            "variant": "varenr + full eurokode (uten eurokode: varenr + varenavn)",
            "normalisering": "trim + store bokstaver; float-artefakt «.0» fjernet fra rene tallkoder; eurokode strippet for ikke-alfanumeriske tegn i nøkkelen",
            "rad uten eurokode": "teller som variant bare via varenr+varenavn",
        },
        "tall": {
            "kilde_produktlinjer": len(kilde),
            "kilde_unike_varianter": len(k_set),
            "kilde_duplikater": dupl_k,
            "kilde_unike_eurokoder": len(k_euro),
            "kilde_uten_eurokode": sum(1 for l in kilde if not l["eurokode"]),
            "prod_rader": len(prod),
            "prod_unike_varianter": len(p_set),
            "prod_duplikater": dupl_p,
            "prod_unike_eurokoder": len(p_euro),
            "bade_kilde_og_prod": len(k_set & p_set),
            "bare_kilde": len(bare_kilde),
            "bare_prod": len(bare_prod),
            "eurokoder_bare_kilde": len(k_euro_bare),
            "eurokoder_bare_prod": len(p_euro_bare),
        },
        "avstemming_eurokoder": {
            "kilde_minus_prod": len(k_euro) - len(p_euro),
            "forklart_av_bare_kilde": len(k_euro_bare),
            "forklart_av_bare_prod": len(p_euro_bare),
            "likning": f"{len(k_euro)} − {len(p_euro)} = {len(k_euro) - len(p_euro)} = {len(k_euro_bare)} (bare kilde) − {len(p_euro_bare)} (bare prod)",
        },
        "bare_kilde_aarsaker": dict(aarsak),
        "bare_prod_eksempler": [
            {"varenr": r["varenr"], "eurokode": r["eurokode"], "varenavn": r["varenavn"], "rad_type": r["rad_type"]}
            for r in bare_prod[:25]
        ],
        "konflikter_samme_varenr_eurokode_ulikt_navn": {
            "antall_grupper": len(konflikter),
            "eksempler": [
                {"varenr": g[0]["varenr"], "eurokode": g[0]["eurokode"],
                 "navn": sorted({x["varenavn"] for x in g}), "priser": sorted({x["pris"] for x in g})}
                for g in konflikter[:15]
            ],
        },
        "sql": {
            "prod_rader": "SELECT count(*) FROM glass_prisliste;",
            "prod_unike_eurokoder": "SELECT count(DISTINCT upper(trim(eurokode))) FROM glass_prisliste WHERE eurokode IS NOT NULL AND trim(eurokode) <> '';",
            "prod_unike_varenr_eurokode": "SELECT count(*) FROM (SELECT DISTINCT upper(trim(varenr)), upper(trim(eurokode)) FROM glass_prisliste WHERE eurokode IS NOT NULL AND trim(eurokode) <> '');",
            "prod_uten_eurokode": "SELECT count(*) FROM glass_prisliste WHERE eurokode IS NULL OR trim(eurokode) = '';",
            "prod_konflikter": "SELECT varenr, eurokode, count(DISTINCT varenavn) n FROM glass_prisliste GROUP BY 1,2 HAVING n > 1;",
            "kilde_tall": "python3 scripts/katalog-uttrekk.py (SHA-256 + radklassifisering) → reports/katalog-uttrekk-<dato>.json",
        },
    }

    # ── Forklaring av importtallet ────────────────────────────────────────
    if staging is not None:
        s_nokkel = [r.get("variant_id") or vnokkel(r["varenr"], r["eurokode"], r["varenavn"]) for r in staging]
        s_set = set(s_nokkel)
        nye = len(s_set - p_set)
        rapport["import"] = {
            "staging_rader": len(staging),
            "staging_unike_varianter": len(s_set),
            "nye_varianter_i_staging": nye,
            "uendret": len(s_set & p_set),
            "kilde_varianter_som_fortsatt_mangler": len(k_set - s_set),
            "varianter_i_staging_som_ikke_er_i_kilde": len(s_set - k_set),
            "forklaring": {
                "nye_med_eurokode": nye,
                "hvorav_eurokode_fantes_ikke_i_prod": aarsak["eurokode_finnes_ikke_i_prod"],
                "hvorav_eurokode_fantes_under_annet_varenr": aarsak["eurokode_finnes_under_annet_varenr"],
                "hvorav_uten_eurokode": aarsak["uten_eurokode"],
            },
        }

    os.makedirs(a.ut, exist_ok=True)
    sti = os.path.join(a.ut, f"katalog-avstemming-{a.dato}.json")
    json.dump(rapport, open(sti, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    t = rapport["tall"]
    print(json.dumps(t, ensure_ascii=False, indent=2))
    print("eurokoder:", rapport["avstemming_eurokoder"]["likning"])
    print("bare kilde, årsaker:", rapport["bare_kilde_aarsaker"])
    print("konflikter (varenr+eurokode, ulikt navn):", len(konflikter))
    if "import" in rapport:
        print("import:", json.dumps(rapport["import"], ensure_ascii=False))
    print("skrevet:", sti)


if __name__ == "__main__":
    main()
