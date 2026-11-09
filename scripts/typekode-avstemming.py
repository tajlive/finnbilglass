#!/usr/bin/env python3
"""Avstemmer typekoder (staging) mot produksjonskatalogen.

Leser:
  /tmp/typekoder.json   – eksport fra staging: varenr, typekode, typekode_beskrivelse
  /tmp/prod-rader.json  – snapshot av produksjonens glass_prisliste

Skriver:
  /tmp/typekode-import.csv    – rader som trygt kan importeres
  /tmp/typekode-konflikter.csv – rader som holdes tilbake, med årsak
  og en oppsummering til stdout.

Klassifisering: typekoden sier hvilken rute det er. Varenavnet sier det samme
med ord. Stemmer de ikke, er raden en konflikt og skal ikke importeres.
"""
import collections
import csv
import json
import re

TYPEKODER = json.load(open('/tmp/typekoder.json'))
TYPEKODER = TYPEKODER[0]['results'] if isinstance(TYPEKODER, list) else TYPEKODER['results']
PROD = json.load(open('/tmp/prod-rader.json'))[0]['results']

# typekode -> forventet rute-type
KODE_TYPE = {
    'F': 'frontrute', 'B': 'bakrute',
    'DFF': 'dorrute', 'DPF': 'dorrute', 'DFB': 'dorrute', 'DPB': 'dorrute',
    'DFFV': 'ventilrute', 'DPFV': 'ventilrute', 'DFBV': 'ventilrute', 'DPBV': 'ventilrute',
    'SFB1': 'siderute', 'SFB2': 'siderute', 'SFB3': 'siderute',
    'SPB1': 'siderute', 'SPB2': 'siderute', 'SPB3': 'siderute',
    'BP': 'ukjent', 'BF': 'ukjent',
}

NAVN_TYPE = [
    ('frontrute', ('FRONTRUTE',)),
    ('bakrute', ('BAKRUTE',)),
    ('dorrute', ('DØRRUTE', 'DORRUTE')),
    ('ventilrute', ('VENTILRUTE',)),
    ('siderute', ('SIDERUTE',)),
]


def navn_type(varenavn):
    n = (varenavn or '').upper()
    for navn, nokler in NAVN_TYPE:
        if any(k in n for k in nokler):
            return navn
    return None


def main():
    prod = {}
    for r in PROD:
        prod[str(r['varenr']).strip().upper()] = r

    ok, konflikt = [], []
    grunn = collections.Counter()

    for t in TYPEKODER:
        varenr = str(t['varenr']).strip().upper()
        kode = (t['typekode'] or '').strip().upper()
        p = prod.get(varenr)

        if p is None:
            grunn['ikke i produksjonskatalogen'] += 1
            konflikt.append((t['varenr'], kode, '', '', 'ikke i produksjonskatalogen'))
            continue

        forventet = KODE_TYPE.get(kode)
        faktisk = navn_type(p.get('varenavn'))
        if forventet is None:
            grunn['ukjent typekode'] += 1
            konflikt.append((t['varenr'], kode, p.get('varenavn', ''), '', 'ukjent typekode'))
        elif forventet != 'ukjent' and faktisk and forventet != faktisk:
            grunn[f'motsier varenavn ({forventet} vs {faktisk})'] += 1
            konflikt.append((t['varenr'], kode, p.get('varenavn', ''), faktisk,
                             f'typekode sier {forventet}, varenavn sier {faktisk}'))
        elif forventet == 'ukjent':
            grunn['kode BP/BF mot front/bak-varenavn'] += 1
            konflikt.append((t['varenr'], kode, p.get('varenavn', ''), faktisk,
                             'kode BP/BF uten dokumentert betydning'))
        else:
            ok.append((t['varenr'], kode, t.get('typekode_beskrivelse') or '',
                       p.get('varenavn', '') or '', p.get('eurokode') or ''))

    with open('/tmp/typekode-import.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['varenr', 'typekode', 'typekode_beskrivelse', 'varenavn', 'eurokode'])
        w.writerows(ok)

    with open('/tmp/typekode-konflikter.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['varenr', 'typekode', 'varenavn', 'type_i_navn', 'aarsak'])
        w.writerows(konflikt)

    print(f'typekoder i staging:      {len(TYPEKODER)}')
    print(f'produksjonsrader:         {len(PROD)}')
    print(f'kan importeres trygt:     {len(ok)}')
    print(f'holdes tilbake:           {len(konflikt)}')
    for g, n in grunn.most_common():
        print(f'   {g:46} {n}')

    print('\ntypekoder i importsettet:')
    for kode, n in collections.Counter(r[1] for r in ok).most_common():
        print(f'   {kode:6} {n}')


if __name__ == '__main__':
    main()
