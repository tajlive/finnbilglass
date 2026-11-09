#!/usr/bin/env python3
"""
Kildeuttrekk fra Autoglass-prislisten (PROSEKT API 16 MAI26.xls).

Formål: bevare originalen 1:1 og samtidig gi normaliserte felt + varsler, slik at
varianttap kan måles i stedet for å gjettes. Skriver:

  reports/katalog-uttrekk-<dato>.json     full maskinlesbar uttrekk
  reports/katalog-uttrekk-<dato>.csv      flat, én rad per produktlinje
  reports/katalog-analyse-<dato>.json     aggregerte funn (duplikater, konflikter)

Regler (per oppdrag 2026-11-04):
  * Identifikatorer behandles som TEKST. Numeriske celler rapporteres med sin
    Excel-formatkode, slik at ledende nuller ikke gjenskapes ved gjetting.
  * Produktlinjer skilles fra sidehoder, sideskift, kolonneoverskrifter og
    rapportinformasjon.
  * Pris 0 og tom pris holdes fra hverandre (0 er en verdi, ikke «mangler»).
  * Mål i fritekst merkes med hva de gjelder (glass/emballasje/sensor/speil),
    enhet og om enheten er dokumentert.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

try:
    import xlrd
except ImportError:  # pragma: no cover
    sys.exit("Mangler xlrd: python3 -m pip install xlrd")


# ── Kolonneindeks (målt mot filen: 7 kolonner) ─────────────────────────────
K_VARENR, K_VARENAVN, K_MERKNAD, K_PRIS, K_TOM1, K_EUROKODE, K_TOM2 = range(7)

SIDE_RE = re.compile(r"^\s*Side\s+\d+\s*$", re.I)
DATO_RE = re.compile(r"^\s*\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*$")
TITTEL_RE = re.compile(r"^\s*Prisliste sortert", re.I)
FIRMA_RE = re.compile(r"^\s*AUTOGLASS AS\s*$", re.I)
BRUKER_RE = re.compile(r"^\s*eduard\s*$", re.I)
OVERSKRIFT_RE = re.compile(r"^\s*Varenr\s*$", re.I)
ALIAS_RE = re.compile(r"^\s*(?:=\s*)?(?:BRUK|USE)\b[\s:]*([A-Z0-9][A-Z0-9 +/._-]*)$", re.I)
# «USE 8432AGACHMV1E» / «=BRUK 1038K» / «BRUK SOM NY ARTIKKEL»

# Posisjonsbokstav i eurokoden: 3–5 sifre + bokstav. A=front, L/R=dør, B=bak,
# F=ventil, S=side. Samme regel som src/glass-posisjon.ts.
POSISJON_RE = re.compile(r"^(\d{3,5})([A-Z])")
POSISJON_BETYDNING = {"A": "frontrute", "L": "dør", "R": "dør", "B": "bakrute", "F": "ventil", "S": "side"}

# ── Mål i fritekst ─────────────────────────────────────────────────────────
# Rekkefølgen betyr noe: første treff bestemmer hva målet GJELDER.
MAAL_MONSTRE = [
    # «EMBALLASJE LITEN (1150x150x720)», «EMB MIDDELS LANG(1900X230X980)», «45x165x70»
    ("emballasje", re.compile(r"(?:EMB(?:ALLASJE)?[^0-9]{0,25})?\(?\s*(\d{2,4})\s*[xX*×]\s*(\d{2,4})(?:\s*[xX*×]\s*(\d{2,4}))?", re.I)),
    # «SENSORPAD S3 B25*H34MM»
    ("sensor", re.compile(r"[BH]\s*(\d{1,2})\s*[*xX]\s*[BH]?\s*(\d{1,2})\s*MM", re.I)),
    # «SPEIL 10 CM NED PÅ RUTEN», «SPEIL: 8 CM FRA TOPP», «LAVT SPEIL HANN 15 CM PÅ»
    ("speil", re.compile(r"SPEIL[^0-9]{0,20}(\d{1,3})\s*CM", re.I)),
    # «OBS MÅL 84X149», «MÅL 48,5X76,5», «OK MÅL=1335*935»
    ("glass", re.compile(r"(?:MÅL|OK\s*MÅL)\s*[=:]?\s*(\d{2,4}(?:[.,]\d)?)\s*[*xX×]\s*(\d{2,4}(?:[.,]\d)?)", re.I)),
    # «bredde 84 cm», «NB-NB 78 CM LANG», «KORT UTGAVE 99 CM»
    ("uklar", re.compile(r"(?:BREDDE|LANG|UTGAVE)?[^0-9]{0,12}(\d{1,3})\s*CM\b", re.I)),
]

AAR_4_LUKKET = re.compile(r"(\d{4})\s*[-–]\s*(\d{4})")
AAR_4_APEN = re.compile(r"(\d{4})\s*[-–]")
AAR_2_LUKKET = re.compile(r"(?:^|[^0-9])(\d{2})\s*[-–]\s*(\d{2})(?:[^0-9]|$)")
AAR_2_APEN = re.compile(r"(?:^|[^0-9])(\d{2})\s*[-–](?:[^0-9]|$)")


def norm_aar(a: int) -> int:
    """Samme regel som src/aar-parser.ts: <30 → 20xx, <100 → 19xx."""
    return 2000 + a if a < 30 else 1900 + a if a < 100 else a


def parse_aar(navn: str | None) -> dict | None:
    """Årvindu fra varenavn — portert fra src/aar-parser.ts (identisk rekkefølge)."""
    if not navn:
        return None
    s = navn.upper()
    m = AAR_4_LUKKET.search(s)
    if m:
        return {"start": int(m.group(1)), "slutt": int(m.group(2)), "type": "lukket", "raa": m.group(0).strip()}
    m = AAR_4_APEN.search(s)
    if m:
        return {"start": int(m.group(1)), "slutt": None, "type": "apen", "raa": m.group(0).strip()}
    m = AAR_2_LUKKET.search(s)
    if m:
        return {"start": norm_aar(int(m.group(1))), "slutt": norm_aar(int(m.group(2))), "type": "lukket", "raa": m.group(0).strip()}
    m = AAR_2_APEN.search(s)
    if m:
        return {"start": norm_aar(int(m.group(1))), "slutt": None, "type": "apen", "raa": m.group(0).strip()}
    return None


def finn_maal(tekst: str) -> list[dict]:
    """Mål i fritekst, med hva målet gjelder og om enheten er dokumentert."""
    if not tekst:
        return []
    ut: list[dict] = []
    rest = tekst
    for slag, rex in MAAL_MONSTRE:
        for m in rex.finditer(rest):
            grupper = [g for g in m.groups() if g]
            if len(grupper) < 2:
                continue
            enhet = "mm" if re.search(r"\d\s*MM\b", m.group(0), re.I) else "cm" if re.search(r"\d\s*CM\b", m.group(0), re.I) else "ukjent"
            # Emballasjemål uten prefiks er bare en x*y-tekst — merk det.
            ukjent_slag = slag == "emballasje" and not re.search(r"EMB", m.group(0), re.I)
            ut.append({
                "slag": "ukjent" if ukjent_slag else slag,
                "raa_tekst": m.group(0).strip(),
                "verdier": [g.replace(",", ".") for g in grupper],
                "enhet": enhet,
                "enhet_dokumentert": enhet != "ukjent",
                "gjelder_glass": (not ukjent_slag) and slag == "glass",
            })
        rest = rex.sub(" ", rest)
    return ut


def eurokode_normalisert(euro: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", euro.upper())


def posisjon_fra_eurokode(euro: str) -> dict:
    n = eurokode_normalisert(euro)
    m = POSISJON_RE.match(n)
    if not m:
        return {"posisjon": None, "grunn": "ikke eurokode-format"}
    bokstav = m.group(2)
    if bokstav in POSISJON_BETYDNING:
        return {"posisjon": POSISJON_BETYDNING[bokstav], "grunn": f"bokstav {bokstav}"}
    return {"posisjon": "frontrute", "grunn": f"bokstav {bokstav} (FR/WS/ukjent markør)"}


def format_analyse(wb, sh, rad: int, kol: int) -> dict:
    """Les Excel-formatkoden for cellen. '?' = xlrd-erstatter for sifferplassholder
    den ikke kjenner igjen; '0'-plassholdere som står igjen betyr tvungen nullutfylling."""
    try:
        xf = wb.xf_list[sh.cell_xf_index(rad, kol)]
        fmt = wb.format_map.get(xf.format_key)
        kode = fmt.format_str if fmt else None
    except Exception:
        kode = None
    if not kode:
        return {"formatkode": None, "ledende_null_risiko": False, "nullutfyllingsbredde": None}
    # Tell sifferplassholdere i heltallsdelen (før evt. desimalpunkt).
    hel = kode.split(".")[0]
    plassholdere = len(re.findall(r"[0#?]", hel))
    return {
        "formatkode": kode,
        "ledende_null_risiko": plassholdere > 0,
        "nullutfyllingsbredde": plassholdere,
    }


def les_ark(sti: str) -> tuple[xlrd.book.Book, xlrd.sheet.Sheet]:
    wb = xlrd.open_workbook(sti, formatting_info=True)
    sh = wb.sheet_by_index(0)
    return wb, sh


def klassifiser_rad(sh, r: int) -> str:
    v = [sh.cell_value(r, c) for c in range(sh.ncols)]
    tekst = [str(x).strip() for x in v]
    if all(not t for t in tekst):
        return "tomrad"
    if any(SIDE_RE.match(t) for t in tekst if t):
        return "sideskift"
    if any(TITTEL_RE.match(t) for t in tekst if t):
        return "rapporttittel"
    if any(FIRMA_RE.match(t) for t in tekst if t):
        return "rapportfirma"
    if any(DATO_RE.match(t) for t in tekst if t):
        return "rapporttid"
    if any(BRUKER_RE.match(t) for t in tekst if t):
        return "rapportbruker"
    if any(OVERSKRIFT_RE.match(t) for t in tekst if t):
        return "kolonneoverskrift"
    return "produktlinje" if tekst[K_VARENR] else "annen"


def les_tekst(celle_verdi, celle_type: int) -> str | None:
    """Rå tekstverdi. Tall konverteres ALDRI til tekst her — det gjøres i
    normaliseringen med eksplisitt varsel, slik at «41.0» ikke blir «41» i stillhet."""
    if celle_type == 0:
        return None
    if celle_type == 2:
        f = float(celle_verdi)
        return str(int(f)) if f.is_integer() else repr(f)
    return str(celle_verdi)


def hoved(sti: str, ut_dir: str, dato: str) -> dict:
    with open(sti, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    wb, sh = les_ark(sti)

    linjer: list[dict] = []
    annet: list[dict] = []
    telling = Counter()

    for r in range(sh.nrows):
        slag = klassifiser_rad(sh, r)
        telling[slag] += 1
        if slag == "produktlinje":
            linjer.append(bygg_linje(wb, sh, r))
        elif slag != "tomrad":
            annet.append({"excel_rad": r + 1, "type": slag,
                          "verdier": [les_tekst(sh.cell_value(r, c), sh.cell_type(r, c)) for c in range(sh.ncols)]})

    # ── Normaliserte lister ────────────────────────────────────────────────
    duplikater_varenr_euro = defaultdict(list)
    duplikater_varenr_navn = defaultdict(list)
    for ln in linjer:
        duplikater_varenr_euro[(ln["varenr"], ln["eurokode"])].append(ln)
        duplikater_varenr_navn[(ln["varenr"], ln["varenavn"])].append(ln)

    unike_varenr = {ln["varenr"] for ln in linjer if ln["varenr"]}
    unike_euro = {ln["eurokode"] for ln in linjer if ln["eurokode"]}
    varenr_til_euro = defaultdict(set)
    euro_til_varenr = defaultdict(set)
    for ln in linjer:
        if ln["varenr"] and ln["eurokode"]:
            varenr_til_euro[ln["varenr"]].add(ln["eurokode"])
            euro_til_varenr[ln["eurokode"]].add(ln["varenr"])

    fler_euro = {v: sorted(e) for v, e in varenr_til_euro.items() if len(e) > 1}
    fler_varenr = {e: sorted(v) for e, v in euro_til_varenr.items() if len(v) > 1}

    like_duplikater = []
    ulike_duplikater = []
    for (varenr, euro), gruppe in duplikater_varenr_euro.items():
        if varenr is None and euro is None:
            continue
        if len(gruppe) < 2:
            continue
        priser = {g["pris"] for g in gruppe}
        navn = {g["varenavn"] for g in gruppe}
        merknader = {g["merknad"] for g in gruppe}
        post = {
            "varenr": varenr, "eurokode": euro,
            "antall": len(gruppe),
            "excel_rader": [g["excel_rad"] for g in gruppe],
            "navn": sorted(navn, key=lambda x: (x is None, x)),
            "priser": sorted(p for p in priser if p is not None),
            "merknader": sorted(m for m in merknader if m),
        }
        if len(priser) == 1 and len(navn) == 1 and len(merknader) == 1:
            like_duplikater.append(post)
        else:
            ulike_duplikater.append(post)

    # Samme varenr + varenavn, ULIKE eurokoder = variantene som forrige import kollapset.
    kollaps_risiko = []
    for (varenr, navn), gruppe in duplikater_varenr_navn.items():
        if varenr is None or len(gruppe) < 2:
            continue
        koder = {g["eurokode"] for g in gruppe}
        if len(koder) > 1:
            kollaps_risiko.append({
                "varenr": varenr, "varenavn": navn,
                "eurokoder": sorted(k for k in koder if k),
                "excel_rader": [g["excel_rad"] for g in gruppe],
                "priser": [g["pris"] for g in gruppe],
                "merknader": [g["merknad"] for g in gruppe],
            })

    maal = [ln for ln in linjer if ln["maal"]]
    analyse = {
        "generert": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "kildefil": sti,
        "sha256": sha,
        "ark": sh.name,
        "antall_rader_i_ark": sh.nrows,
        "radtyper": dict(telling),
        "produktlinjer": len(linjer),
        "unike_varenr": len(unike_varenr),
        "unike_eurokoder": len(unike_euro),
        "varenr_med_flere_eurokoder": {
            "antall": len(fler_euro),
            "eksempler": dict(list(sorted(fler_euro.items(), key=lambda kv: -len(kv[1])))[:15]),
        },
        "eurokoder_med_flere_varenr": {
            "antall": len(fler_varenr),
            "eksempler": dict(list(sorted(fler_varenr.items(), key=lambda kv: -len(kv[1])))[:15]),
        },
        "duplikater_like": {"antall": len(like_duplikater), "eksempler": like_duplikater[:10]},
        "duplikater_ulike": {"antall": len(ulike_duplikater), "eksempler": ulike_duplikater[:20]},
        "rader_uten_eurokode": sum(1 for ln in linjer if not ln["eurokode"]),
        "rader_uten_varenr": sum(1 for ln in linjer if not ln["varenr"]),
        "rader_uten_eurokode_eller_varenr": sum(1 for ln in linjer if not ln["eurokode"] or not ln["varenr"]),
        "varenavn_med_ulike_eurokoder_samme_varenr": {"antall": len(kollaps_risiko), "eksempler": kollaps_risiko[:30]},
        "varsler": dict(Counter(v for ln in linjer for v in ln["varsler"])),
        "aar": dict(Counter((ln["aar"] or {}).get("type", "ukjent") for ln in linjer)),
        "maal": {
            "linjer_med_maal": len(maal),
            "slag": dict(Counter(m["slag"] for ln in maal for m in ln["maal"])),
            "enhet": dict(Counter(m["enhet"] for ln in maal for m in ln["maal"])),
            "kun_glassmaal": sum(1 for ln in maal for m in ln["maal"] if m["gjelder_glass"]),
            "eksempler": [{"excel_rad": ln["excel_rad"], "varenr": ln["varenr"],
                           "varenavn": ln["varenavn"], "merknad": ln["merknad"], "maal": ln["maal"]}
                          for ln in maal[:25]],
        },
        "alias_rader": sum(1 for ln in linjer if ln["alias_av"]),
    }

    os.makedirs(ut_dir, exist_ok=True)
    json_sti = os.path.join(ut_dir, f"katalog-uttrekk-{dato}.json")
    csv_sti = os.path.join(ut_dir, f"katalog-uttrekk-{dato}.csv")
    analyse_sti = os.path.join(ut_dir, f"katalog-analyse-{dato}.json")

    with open(json_sti, "w", encoding="utf-8") as fh:
        json.dump({"kildefil": sti, "sha256": sha, "ark": sh.name, "linjer": linjer, "ikke_produktlinjer": annet}, fh,
                  ensure_ascii=False, indent=1)
    with open(analyse_sti, "w", encoding="utf-8") as fh:
        json.dump(analyse, fh, ensure_ascii=False, indent=2)

    with open(csv_sti, "w", encoding="utf-8", newline="") as fh:
        felt = ["excel_rad", "varenr", "varenr_raw", "eurokode", "varenavn", "merknad", "pris",
                "aar_start", "aar_slutt", "aar_type", "posisjon", "alias_av", "variant_id",
                "maal", "varsler"]
        w = csv.DictWriter(fh, fieldnames=felt)
        w.writeheader()
        for ln in linjer:
            a = ln["aar"] or {}
            w.writerow({
                "excel_rad": ln["excel_rad"], "varenr": ln["varenr"], "varenr_raw": ln["varenr_raw"],
                "eurokode": ln["eurokode"], "varenavn": ln["varenavn"], "merknad": ln["merknad"],
                "pris": ln["pris"], "aar_start": a.get("start"), "aar_slutt": a.get("slutt"),
                "aar_type": a.get("type"), "posisjon": ln["posisjon"].get("posisjon"),
                "alias_av": ln["alias_av"], "variant_id": ln["variant_id"],
                "maal": json.dumps(ln["maal"], ensure_ascii=False),
                "varsler": ",".join(ln["varsler"]),
            })

    return {"analyse": analyse, "json": json_sti, "csv": csv_sti, "analysefil": analyse_sti}


def bygg_linje(wb, sh, r: int) -> dict:
    raa_varenr = sh.cell_value(r, K_VARENR)
    raa_varenavn = sh.cell_value(r, K_VARENAVN)
    raa_merknad = sh.cell_value(r, K_MERKNAD)
    raa_pris = sh.cell_value(r, K_PRIS)
    raa_euro = sh.cell_value(r, K_EUROKODE)

    varsler: list[str] = []

    # ── Varenr: tekst eller tall? ─────────────────────────────────────────
    varenr_raw = les_tekst(raa_varenr, sh.cell_type(r, K_VARENR))
    if sh.cell_type(r, K_VARENR) == 2:
        f = format_analyse(wb, sh, r, K_VARENR)
        varenr = str(int(raa_varenr)) if float(raa_varenr).is_integer() else str(raa_varenr)
        varsler.append("varenr_er_tall")
        bredde = f["nullutfyllingsbredde"]
        if f["ledende_null_risiko"] and bredde and len(varenr.split(".")[0]) < bredde:
            varsler.append("varenr_ledende_null_usikker")
            # Behold BEGGE tolkninger — aldri gjett.
            varenr_raw = f"tall:{varenr} (visning kan være {varenr.zfill(bredde)}, format {f['formatkode']!r})"
    else:
        varenr = str(raa_varenr).strip()

    # ── Eurokode ──────────────────────────────────────────────────────────
    if sh.cell_type(r, K_EUROKODE) == 2:
        f = format_analyse(wb, sh, r, K_EUROKODE)
        euro = str(int(raa_euro)) if float(raa_euro).is_integer() else str(raa_euro)
        varsler.append("eurokode_er_tall")
        bredde = f["nullutfyllingsbredde"]
        if f["ledende_null_risiko"] and bredde and len(euro) < bredde:
            varsler.append("eurokode_ledende_null_usikker")
    else:
        euro = str(raa_euro).strip()

    # Originalteksten bevares: KUN ledende/avsluttende mellomrom fjernes (det gjorde
    # også den opprinnelige importen). Intern ordlyd og mellomrom er en del av
    # identiteten — f.eks. skiller «17-18 » og «17-18» to katalogførte varianter.
    varenavn = str(raa_varenavn).strip()
    varenavn_renset = re.sub(r"\s+", " ", varenavn).strip()
    merknad = str(raa_merknad).strip()
    merknad_renset = re.sub(r"\s+", " ", merknad).strip()

    if not euro:
        varsler.append("mangler_eurokode")
    if not varenr:
        varsler.append("mangler_varenr")
    if not varenavn:
        varsler.append("mangler_varenavn")
    if "USE" in varenavn.upper() or "BRUK" in varenavn.upper():
        if ALIAS_RE.match(varenavn):
            varsler.append("erstatningspeker")

    # ── Pris: skille 0 fra tomt ───────────────────────────────────────────
    if sh.cell_type(r, K_PRIS) == 2:
        pris = float(raa_pris)
        if pris == 0:
            varsler.append("pris_er_null")
    else:
        pris = None
        varsler.append("pris_mangler")

    alias_av = None
    m = ALIAS_RE.match(varenavn)
    if m:
        alias_av = m.group(1).strip()

    aar = parse_aar(varenavn)
    if aar is None:
        varsler.append("aar_ukjent")
    elif aar["type"] == "apen":
        varsler.append("aar_apen_periode")

    posisjon = posisjon_fra_eurokode(euro) if euro else {"posisjon": None, "grunn": "mangler eurokode"}
    maal = finn_maal(merknad) + finn_maal(varenavn)
    if maal and not any(m["gjelder_glass"] for m in maal):
        varsler.append("maal_uten_glassbetydning")

    # ── Variant-id (identitet som tåler flere eurokoder per varenr) ───────
    varenr_n = varenr.upper()
    euro_n = eurokode_normalisert(euro)
    if euro_n:
        variant_id = f"{varenr_n}:{euro_n}"
    elif varenr_n:
        variant_id = f"{varenr_n}:~{varenavn.upper()}"
    else:
        variant_id = None

    return {
        "excel_rad": r + 1,
        "varenr": varenr,
        "varenr_raw": varenr_raw,
        "varenr_celletype": sh.cell_type(r, K_VARENR),
        "eurokode": euro,
        "eurokode_raw": les_tekst(raa_euro, sh.cell_type(r, K_EUROKODE)),
        "eurokode_normalisert": euro_n,
        "eurokode_celletype": sh.cell_type(r, K_EUROKODE),
        "varenavn": varenavn or None,
        "varenavn_raw": str(raa_varenavn),
        "varenavn_renset": varenavn_renset or None,
        "merknad": merknad or None,
        "merknad_renset": merknad_renset or None,
        "pris": pris,
        "aar": aar,
        "posisjon": posisjon,
        "alias_av": alias_av,
        "maal": maal,
        "variant_id": variant_id,
        "varsler": varsler,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--xls", default="/Users/taj/bilglass/PROSEKT API 16 MAI26.xls")
    p.add_argument("--ut", default="/Users/taj/finnbilglass/reports")
    p.add_argument("--dato", default=datetime.now(timezone.utc).strftime("%Y%m%d"))
    a = p.parse_args()
    res = hoved(a.xls, a.ut, a.dato)
    an = res["analyse"]
    print(json.dumps({k: an[k] for k in (
        "sha256", "antall_rader_i_ark", "radtyper", "produktlinjer", "unike_varenr", "unike_eurokoder",
        "rader_uten_eurokode", "rader_uten_varenr", "rader_uten_eurokode_eller_varenr", "varsler", "aar")},
        ensure_ascii=False, indent=2))
    print("varenr med flere eurokoder:", an["varenr_med_flere_eurokoder"]["antall"])
    print("eurokoder med flere varenr:", an["eurokoder_med_flere_varenr"]["antall"])
    print("duplikater like:", an["duplikater_like"]["antall"], "ulike:", an["duplikater_ulike"]["antall"])
    print("kollaps-risiko (varenr+navn, ulike eurokoder):", an["varenavn_med_ulike_eurokoder_samme_varenr"]["antall"])
    print("mål:", an["maal"]["linjer_med_maal"], an["maal"]["slag"], an["maal"]["enhet"])
    print("filer:", res["json"], res["csv"], res["analysefil"])
