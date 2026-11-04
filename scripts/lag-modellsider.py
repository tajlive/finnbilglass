#!/usr/bin/env python3
"""Genererer modellsider (UTKAST) fra katalogsnapshotet.

Bare aggregat: årsspenn, glasstyper og antall varianter per generasjon.
Ingen kjennemerker, ingen kundeopplysninger, ingen påstand om passform.

Kjør: python3 scripts/lag-modellsider.py [snapshot.json]
Skriver public/bilglass/<slug>.html med robots=noindex (utkast).
"""
import collections
import html
import json
import os
import re
import sys

SNAP = sys.argv[1] if len(sys.argv) > 1 else '/tmp/prod-rader.json'

MODELLER = [
    {
        'slug': 'vw-golf',
        'merke': 'VW',
        'token': 'GOLF',
        'navn': 'Volkswagen Golf',
        'tittel': 'Bilglass til Volkswagen Golf – oversikt over dokumenterte varianter',
        'ingress': 'Golf er solgt i mange generasjoner med ulike ruter. Her ser du hvilke '
                   'generasjoner og glasstyper katalogen vår har oppført, og hvordan du går videre.',
    },
    {
        'slug': 'bmw-3-serie',
        'merke': 'BMW',
        'token': '3 SERIE',
        'navn': 'BMW 3-serie',
        'tittel': 'Bilglass til BMW 3-serie – oversikt over dokumenterte varianter',
        'ingress': '3-serien har skiftet både karosseri og ruter gjennom generasjonene. '
                   'Her ser du hva katalogen vår har oppført, og hva som må kontrolleres før kjøp.',
    },
    {
        'slug': 'toyota-rav4',
        'merke': 'TOYOTA',
        'token': 'RAV 4',
        'navn': 'Toyota RAV4',
        'tittel': 'Bilglass til Toyota RAV4 – oversikt over dokumenterte varianter',
        'ingress': 'RAV4 finnes både med og uten oppvarmet frontrute og med ulike '
                   'førerassistentsystemer. Her ser du hva katalogen skiller mellom.',
    },
]

TYPEORD = [
    ('Frontrute', ('FRONTRUTE', 'FRONT')),
    ('Bakrute', ('BAKRUTE', 'BAK')),
    ('Dørrute', ('DØRRUTE', 'DØR', 'DOR')),
    ('Side-/ventilrute', ('VENTIL', 'SIDE')),
]


def type_av(navn: str) -> str:
    n = navn.upper()
    for etikett, nokler in TYPEORD:
        if any(k in n for k in nokler):
            return etikett
    return 'Annet/uavklart'


def aarsspenn(navn: str) -> str:
    """Henter årstall fra varenavnet, f.eks. '83-90' eller '2011-'."""
    m = re.search(r'\b(19\d{2}|20\d{2})\s*-\s*(19\d{2}|20\d{2})?', navn)
    if m:
        return m.group(1) + ('–' + m.group(2) if m.group(2) else '–')
    m = re.search(r'\b(\d{2})\s*-\s*(\d{2})\b', navn)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        start = 1900 + a if a > 30 else 2000 + a
        slutt = 1900 + b if b > 30 else 2000 + b
        return f'{start}–{slutt}'
    return 'ukjent år'


def main() -> None:
    rader = json.load(open(SNAP))[0]['results']
    os.makedirs('public/bilglass', exist_ok=True)
    mal = open('scripts/mal-modellside.html').read()

    for m in MODELLER:
        treff = [r for r in rader
                 if str(r.get('varenavn') or '').upper().startswith(m['merke'])
                 and m['token'] in str(r.get('varenavn') or '').upper()]
        if not treff:
            print(f'  {m["slug"]}: 0 rader – hoppet over')
            continue

        per_spenn = collections.defaultdict(lambda: collections.Counter())
        for r in treff:
            spenn = aarsspenn(str(r.get('varenavn') or ''))
            per_spenn[spenn][type_av(str(r.get('varenavn') or ''))] += 1

        # bare spenn med mer enn én rad gir informasjon
        brukbare = {k: v for k, v in per_spenn.items() if sum(v.values()) >= 2 and k != 'ukjent år'}
        typer = collections.Counter()
        for v in per_spenn.values():
            typer.update(v)

        priser = [r['pris'] for r in treff if isinstance(r.get('pris'), (int, float)) and r['pris'] > 0]

        rader_html = ''.join(
            f'<tr><td>{html.escape(spenn)}</td>'
            f'<td>{sum(v.values())}</td>'
            f'<td>{html.escape(", ".join(f"{t} ({n})" for t, n in v.most_common()))}</td></tr>'
            for spenn, v in sorted(brukbare.items())
        ) or '<tr><td colspan="3">Katalogen har varianter, men årstallene er ikke oppgitt i varenavnet.</td></tr>'

        side = (mal
                .replace('{{TITTEL}}', html.escape(m['tittel']))
                .replace('{{NAVN}}', html.escape(m['navn']))
                .replace('{{INGRESS}}', html.escape(m['ingress']))
                .replace('{{SLUG}}', m['slug'])
                .replace('{{ANTALL}}', str(len(treff)))
                .replace('{{PRISSATTE}}', str(len(priser)))
                .replace('{{TYPER}}', html.escape(', '.join(f'{t} ({n})' for t, n in typer.most_common())))
                .replace('{{RADER}}', rader_html))
        sti = f'public/bilglass/{m["slug"]}.html'
        open(sti, 'w').write(side)
        print(f'  {m["slug"]}: {len(treff)} rader, {len(brukbare)} årsspenn, '
              f'{len(priser)} prissatte → {sti}')


if __name__ == '__main__':
    main()
