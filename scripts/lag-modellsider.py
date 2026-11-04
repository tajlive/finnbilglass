#!/usr/bin/env python3
"""Genererer modellsider (UTKAST) fra katalogsnapshotet.

Prinsipper:
- Bare aggregat: antall rader, glasstyper og prissatte rader. Ingen kjennemerker,
  ingen kundeopplysninger, ingen påstand om passform.
- Generasjonsgrenser hentes fra dokumentert kilde (Wikipedia: Volkswagen Golf,
  produksjonsstart Mk1 1974 til Mk8 2019), ikke gjettet fra produktnavn.
- En katalograd telles bare i en generasjon når hele årsspennet i varenavnet
  ligger innenfor generasjonens produksjonsvindu. Alt annet er «uavklart» og
  utelates fra tabellen.
- Glasstype settes bare når varenavnet faktisk sier det. Ellers «type ikke oppgitt».

Kjør: python3 scripts/lag-modellsider.py [snapshot.json]
"""
import collections
import html
import json
import os
import re
import sys

SNAP = sys.argv[1] if len(sys.argv) > 1 else '/tmp/prod-rader.json'
I_DAG = 2026

# Kilde: https://en.wikipedia.org/wiki/Volkswagen_Golf
# «Produced by Volkswagen since 1974 … across eight generations».
# Produksjonsstart: Mk1 1974, Mk2 1983, Mk3 1991, Mk4 1997, Mk5 2003,
# Mk6 2008, Mk7 2012, Mk8 2019. Vinduet slutter året før neste generasjon.
GOLF_GENERASJONER = [
    ('Golf I', 1974, 1982),
    ('Golf II', 1983, 1990),
    ('Golf III', 1991, 1996),
    ('Golf IV', 1997, 2002),
    ('Golf V', 2003, 2007),
    ('Golf VI', 2008, 2011),
    ('Golf VII', 2012, 2018),
    ('Golf VIII', 2019, I_DAG),
]

TYPEORD = [
    ('Frontrute', ('FRONTRUTE',)),
    ('Bakrute', ('BAKRUTE',)),
    ('Dørrute', ('DØRRUTE', 'DORRUTE')),
    ('Ventilrute', ('VENTILRUTE',)),
    ('Siderute', ('SIDERUTE',)),
]


def type_av(navn):
    n = navn.upper()
    for etikett, nokler in TYPEORD:
        if any(k in n for k in nokler):
            return etikett
    return None


def spenn(navn):
    """Årsspenn fra varenavnet som (start, slutt), eller None."""
    m = re.search(r'\b(19\d{2}|20\d{2})\s*-\s*(19\d{2}|20\d{2})?', navn)
    if m:
        start = int(m.group(1))
        slutt = int(m.group(2)) if m.group(2) else I_DAG
        return (start, slutt) if start <= slutt else None
    m = re.search(r'\b(\d{2})\s*-\s*(\d{2})\b', navn)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        start = 1900 + a if a > 40 else 2000 + a
        slutt = 1900 + b if b > 40 else 2000 + b
        return (start, slutt) if 1970 <= start <= slutt else None
    return None


def main():
    rader = json.load(open(SNAP))[0]['results']
    os.makedirs('public/bilglass', exist_ok=True)

    treff = [r for r in rader
             if str(r.get('varenavn') or '').upper().startswith('VW')
             and 'GOLF' in str(r.get('varenavn') or '').upper()]

    per_gen = collections.defaultdict(collections.Counter)
    ukjent_type = 0
    uavklart = 0
    prissatte = 0

    for r in treff:
        navn = str(r.get('varenavn') or '')
        t = type_av(navn)
        s = spenn(navn)
        if isinstance(r.get('pris'), (int, float)) and r['pris'] > 0:
            prissatte += 1
        if t is None:
            ukjent_type += 1
        gen = None
        if s:
            for navn_gen, fra, til in GOLF_GENERASJONER:
                if fra <= s[0] and s[1] <= til:
                    gen = navn_gen
                    break
        if gen is None:
            uavklart += 1
            continue
        per_gen[gen][t or 'Type ikke oppgitt'] += 1

    totalt = sum(sum(v.values()) for v in per_gen.values())

    rader_html = ''
    for navn_gen, fra, til in GOLF_GENERASJONER:
        v = per_gen.get(navn_gen)
        if not v:
            continue
        fordeling = ', '.join('%s (%d)' % (t, n) for t, n in v.most_common())
        rader_html += ('<tr><td><strong>%s</strong></td><td>%d–%d</td><td>%d</td>'
                       '<td>%s</td></tr>\n'
                       % (html.escape(navn_gen), fra, til, sum(v.values()), html.escape(fordeling)))
    if not rader_html:
        rader_html = '<tr><td colspan="4">Ingen rader kunne plasseres sikkert i en generasjon.</td></tr>'

    side = (open('scripts/mal-modellside.html').read()
            .replace('{{TITTEL}}', 'Bilglass til Volkswagen Golf – hva katalogen dekker')
            .replace('{{NAVN}}', 'Volkswagen Golf')
            .replace('{{INGRESS}}', 'Golf er laget i åtte generasjoner siden 1974, og rutene er '
                                    'ulike fra generasjon til generasjon. Her ser du hva katalogen '
                                    'vår faktisk har registrert, og hva den ikke sier noe om.')
            .replace('{{SLUG}}', 'vw-golf')
            .replace('{{ANTALL}}', str(len(treff)))
            .replace('{{PRISSATTE}}', str(prissatte))
            .replace('{{ITABELL}}', str(totalt))
            .replace('{{UAVKLART}}', str(uavklart))
            .replace('{{UKJENTTYPE}}', str(ukjent_type))
            .replace('{{RADER}}', rader_html))
    open('public/bilglass/vw-golf.html', 'w').write(side)

    print('Golf: %d katalograder, %d prissatte' % (len(treff), prissatte))
    print('  i tabell: %d  (uavklart: %d, uten type: %d)' % (totalt, uavklart, ukjent_type))
    for navn_gen, fra, til in GOLF_GENERASJONER:
        v = per_gen.get(navn_gen)
        if v:
            print('  %-9s %d-%d  %3d  %s' % (navn_gen, fra, til, sum(v.values()), dict(v)))


if __name__ == '__main__':
    main()
