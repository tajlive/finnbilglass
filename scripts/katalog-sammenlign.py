#!/usr/bin/env python3
"""
Sammenligner XLS-uttrekket med det som faktisk ligger i D1 (glass_prisliste).

Svarer på oppdragets spørsmål 3 og 7:
  * hvor mange produktlinjer finnes i kilden, hvor mange nådde databasen
  * hvilke rader forsvant, og i hvilket ledd
  * hvilke varenr-familier som er slått sammen (flere eurokoder → én rad)
  * hvilke varenr ground_truth peker på, og om de har ufullstendige varianter

Bruk:
  python3 scripts/katalog-sammenlign.py \
      --uttrekk reports/katalog-uttrekk-20261104.json \
      --db reports/_prod-prisliste-dump-20261104.json \
      [--gt reports/_gt-dump.json] [--ut reports]
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict


def les_uttrekk(sti: str) -> list[dict]:
    d = json.load(open(sti, encoding="utf-8"))
    return d["linjer"]


def les_db(sti: str) -> list[dict]:
    d = json.load(open(sti, encoding="utf-8"))
    return d[0]["results"] if isinstance(d, list) else d["results"]


def norm_navn(s: str | None) -> str:
    return (s or "").strip()


def norm_kode(s) -> str:
    """Identifikator-normalisering for SAMMENLIGNING (ikke for lagring).

    Fjerner også float-artefakten «.0» som oppstod da importen skrev numeriske
    celler som tall: kilden har «3397110041», DB har «3397110041.0».
    """
    t = str(s or "").strip().upper()
    if re.fullmatch(r"\d+\.0", t):
        t = t[:-2]
    return t


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--uttrekk", default="reports/katalog-uttrekk-20261104.json")
    p.add_argument("--db", default="reports/_prod-prisliste-dump-20261104.json")
    p.add_argument("--gt", default=None)
    p.add_argument("--ut", default="reports")
    p.add_argument("--dato", default="20261104")
    a = p.parse_args()

    linjer = les_uttrekk(a.uttrekk)
    db = les_db(a.db)

    # ── Simuler den opprinnelige importen: UNIQUE(varenr, varenavn) ──────
    sett: dict[tuple[str, str], dict] = {}
    kollapset: list[dict] = []
    for ln in linjer:
        nokkel = (norm_kode(ln["varenr"]), norm_navn(ln["varenavn"]))
        if nokkel in sett:
            kollapset.append({"excel_rad": ln["excel_rad"], "varenr": ln["varenr"],
                              "eurokode": ln["eurokode"], "varenavn": ln["varenavn"],
                              "pris": ln["pris"],
                              "beholdt_eurokode": sett[nokkel]["eurokode"],
                              "beholdt_excel_rad": sett[nokkel]["excel_rad"]})
            continue
        sett[nokkel] = ln

    # ── Hva ligger i DB? ─────────────────────────────────────────────────
    db_par = {(norm_kode(r["varenr"]), norm_navn(r["varenavn"])) for r in db}
    db_euro = {norm_kode(r["eurokode"]) for r in db if r["eurokode"]}
    db_varenr = defaultdict(set)
    for r in db:
        if r["eurokode"]:
            db_varenr[norm_kode(r["varenr"])].add(norm_kode(r["eurokode"]))

    # Kildevarianter (varenr + eurokode) som ikke finnes i DB
    manglende_varianter = []
    for ln in linjer:
        if not ln["eurokode"]:
            continue
        if norm_kode(ln["eurokode"]) not in db_euro:
            manglende_varianter.append(ln)

    # ── Årsaksklassifisering av hver tapt variant ────────────────────────
    # A: varenr+varenavn fantes fra før → UNIQUE(varenr, varenavn) kollapset raden
    # B: raden finnes ikke i DB i det hele tatt, og identifikatoren er numerisk
    # C: raden finnes ikke, ukjent årsak (import-filter e.l.)
    kollaps_nokler = {(norm_kode(k["varenr"]), norm_navn(k["varenavn"])) for k in kollapset}
    aarsak = Counter()
    for ln in manglende_varianter:
        nokkel = (norm_kode(ln["varenr"]), norm_navn(ln["varenavn"]))
        if nokkel in kollaps_nokler:
            ln["tapt_aarsak"] = "A_unique_varenr_varenavn"
        elif ln["varenr_celletype"] == 2 or ln["eurokode_celletype"] == 2:
            ln["tapt_aarsak"] = "B_numerisk_identifikator"
        else:
            ln["tapt_aarsak"] = "C_ukjent"
        aarsak[ln["tapt_aarsak"]] += 1

    # Bare frontrute-varianter — samme vakt som erFrontrute() i src/vin-resolver.ts
    # (posisjon A + ikke navnemarkør for dør/side/bak/list + ikke PY/GU/K-suffiks).
    IKKE_FRONTRUTE = re.compile(
        r"(?<![A-ZÆØÅ0-9])(DØRRUTE|DORRUTE|SIDERUTE|SIDORUTE|SIDORUTA|SIDERUTA|BAKRUTE|BAGRUTE|"
        r"BACKLITE|SUNROOF|SOLTAK|HATCH|TAKLUKE|TAKRUTE|PANORAMA|REAR|QUARTER|VENT|"
        r"PYNTELIST|GUMMILIST|KLIPS|PAKNING)(?![A-ZÆØÅ0-9])"
    )

    def er_frontrute(ln: dict) -> bool:
        navn = (ln["varenavn"] or "").upper()
        if IKKE_FRONTRUTE.search(navn):
            return False
        varenr = (ln["varenr"] or "").upper()
        if re.search(r"(?:PY|GU)[A-Z]{0,4}$", varenr):
            return False
        if re.fullmatch(r"\d{3,5}K", varenr):
            return False
        if re.match(r"^\d{3,5}[LR]", varenr):
            return False
        return ln["posisjon"].get("posisjon") == "frontrute"

    tapte_frontruter = [ln for ln in manglende_varianter if er_frontrute(ln)]

    # Kildevarianter (uten eurokode) som ikke finnes i DB
    manglende_uten_euro = []
    for ln in linjer:
        if ln["eurokode"]:
            continue
        if (norm_kode(ln["varenr"]), norm_navn(ln["varenavn"])) not in db_par:
            manglende_uten_euro.append(ln)

    # ── Varenr-familier: kildens eurokoder vs DBs ────────────────────────
    kilde_varenr = defaultdict(set)
    kilde_navn = defaultdict(set)
    for ln in linjer:
        if ln["eurokode"] and ln["varenr"]:
            kilde_varenr[norm_kode(ln["varenr"])].add(norm_kode(ln["eurokode"]))
            kilde_navn[norm_kode(ln["varenr"])].add(ln["varenavn"])

    ufullstendige = []
    for varenr, koder in kilde_varenr.items():
        mangler = sorted(koder - db_varenr.get(varenr, set()))
        if mangler:
            ufullstendige.append({
                "varenr": varenr,
                "kilde_eurokoder": sorted(koder),
                "db_eurokoder": sorted(db_varenr.get(varenr, set())),
                "mangler": mangler,
                "antall_kilde": len(koder),
                "antall_db": len(db_varenr.get(varenr, set())),
            })
    ufullstendige.sort(key=lambda x: (-len(x["mangler"]), x["varenr"]))

    # ── GT-refererte varenr: hvor mange har ufullstendige varianter? ─────
    gt_info = None
    if a.gt and os.path.exists(a.gt):
        gt = les_db(a.gt)
        gt_koder = Counter(norm_kode(r["frontrute_eurocode"]) for r in gt)
        gt_ufullstendig = [u for u in ufullstendige if u["varenr"] in gt_koder]
        gt_info = {
            "antall_gt_rader": len(gt),
            "unike_gt_koder": len(gt_koder),
            "gt_koder_som_er_varenr": sum(1 for k in gt_koder if k in kilde_varenr or any(
                norm_kode(r["varenr"]) == k for r in db)),
            "gt_koder_med_manglende_varianter": len(gt_ufullstendig),
            "topp": [{"varenr": u["varenr"], "gt_rader": gt_koder[u["varenr"]],
                      "mangler": u["mangler"]} for u in gt_ufullstendig[:25]],
        }

    # ── Tallmessing ──────────────────────────────────────────────────────
    like_par = sum(1 for ln in linjer if (norm_kode(ln["varenr"]), norm_navn(ln["varenavn"])) in db_par)
    rapport = {
        "kilde": {
            "produktlinjer": len(linjer),
            "unike_varenr": len({norm_kode(l["varenr"]) for l in linjer}),
            "unike_eurokoder": len({norm_kode(l["eurokode"]) for l in linjer if l["eurokode"]}),
            "uten_eurokode": sum(1 for l in linjer if not l["eurokode"]),
        },
        "db": {
            "rader": len(db),
            "unike_varenr": len({norm_kode(r["varenr"]) for r in db}),
            "unike_eurokoder": len(db_euro),
            "radtyper": dict(Counter(r["rad_type"] for r in db)),
        },
        "import_simulering": {
            "unike_varenr_navn": len(sett),
            "kollapset_av_unique_varenr_varenavn": len(kollapset),
            "kilde_minus_db": len(linjer) - len(db),
            "kilde_linjer_gjenfunnet_paa_varenr_navn": like_par,
        },
        "tapte_varianter": {
            "med_eurokode": len(manglende_varianter),
            "uten_eurokode": len(manglende_uten_euro),
            "aarsaker": dict(aarsak),
            "frontruter": len(tapte_frontruter),
            "frontruter_med_pris": sum(1 for l in tapte_frontruter if (l["pris"] or 0) > 0),
            "frontruter_pris_null": sum(1 for l in tapte_frontruter if l["pris"] == 0),
            "frontruter_pris_mangler": sum(1 for l in tapte_frontruter if l["pris"] is None),
            "frontruter_unike_varenr": len({l["varenr"] for l in tapte_frontruter}),
            "frontrute_eksempler": [
                {"excel_rad": l["excel_rad"], "varenr": l["varenr"], "eurokode": l["eurokode"],
                 "varenavn": l["varenavn"], "merknad": l["merknad"], "pris": l["pris"],
                 "aarsak": l["tapt_aarsak"]} for l in tapte_frontruter[:40]
            ],
            "eksempler_med_eurokode": [
                {"excel_rad": l["excel_rad"], "varenr": l["varenr"], "eurokode": l["eurokode"],
                 "varenavn": l["varenavn"], "pris": l["pris"], "aarsak": l["tapt_aarsak"]}
                for l in manglende_varianter[:40]
            ],
        },
        "varenr_familier_med_manglende_varianter": {
            "antall": len(ufullstendige),
            "eksempler": ufullstendige[:40],
        },
        "kollaps_eksempler": kollapset[:40],
        "gt": gt_info,
    }

    sti = os.path.join(a.ut, f"katalog-sammenlign-{a.dato}.json")
    json.dump(rapport, open(sti, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(json.dumps(rapport["kilde"], ensure_ascii=False))
    print(json.dumps(rapport["db"], ensure_ascii=False))
    print(json.dumps(rapport["import_simulering"], ensure_ascii=False))
    print(json.dumps(rapport["tapte_varianter"], ensure_ascii=False)[:600])
    print("varenr-familier med manglende varianter:", len(ufullstendige))
    for u in ufullstendige[:15]:
        print("  ", u["varenr"], "kilde", u["antall_kilde"], "db", u["antall_db"], "mangler", u["mangler"])
    if gt_info:
        print(json.dumps({k: gt_info[k] for k in ("antall_gt_rader", "unike_gt_koder", "gt_koder_som_er_varenr", "gt_koder_med_manglende_varianter")}, ensure_ascii=False))
    print("skrevet:", sti)


if __name__ == "__main__":
    main()
