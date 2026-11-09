#!/usr/bin/env python3
"""Henter Search Console-data for finnbilglass.no.

Bruker tjenestekontoen hermes-search-console@klarpakke-universitet.
Tjenestekontoen må være lagt til som bruker i Search Console for eiendommen.

Kjør: python3 scripts/gsc-rapport.py [dager]
Skriver reports/gsc-*.json og topp 20 til stdout. HTTP går via curl fordi
system-Python mangler CA-røtter.
"""
import datetime
import json
import os
import subprocess
import sys

SA = 'hermes-search-console@klarpakke-universitet.iam.gserviceaccount.com'
KEY = os.path.expanduser('~/.hermes/gsc-service-account.json')
CFG = '/tmp/gsc-gcloud'


def http(url: str, token: str, body: dict | None = None) -> dict:
    cmd = ['curl', '-s', url, '-H', 'Authorization: Bearer ' + token,
           '-H', 'Content-Type: application/json']
    if body is not None:
        cmd += ['-X', 'POST', '-d', json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    try:
        return json.loads(out) if out.strip() else {}
    except json.JSONDecodeError:
        return {'_raw': out[:300]}


def token() -> str:
    os.makedirs(CFG, exist_ok=True)
    env = dict(os.environ, CLOUDSDK_CONFIG=CFG)
    subprocess.run(['gcloud', 'auth', 'activate-service-account', '--key-file', KEY],
                   env=env, capture_output=True, check=True)
    out = subprocess.run(['gcloud', 'auth', 'print-access-token',
                          '--scopes=https://www.googleapis.com/auth/webmasters.readonly'],
                         env=env, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def main() -> None:
    dager = int(sys.argv[1]) if len(sys.argv) > 1 else 90
    tok = token()

    sider = http('https://searchconsole.googleapis.com/webmasters/v3/sites', tok).get('siteEntry', [])
    navn = [s.get('siteUrl') for s in sider]
    print('Eiendommer tjenestekontoen ser:', navn or 'INGEN')
    if not sider:
        print('\n→ Legg til denne adressen som bruker i Search Console (Tillatelse: Begrenset):')
        print('  ', SA)
        return

    site = next((s['siteUrl'] for s in sider if 'finnbilglass' in s['siteUrl']), sider[0]['siteUrl'])
    slutt = datetime.date.today()
    start = slutt - datetime.timedelta(days=dager)
    os.makedirs('reports', exist_ok=True)

    for dims, kort in [(['query'], 'sok'), (['page'], 'sider'), (['query', 'page'], 'sok-per-side')]:
        body = {'startDate': start.isoformat(), 'endDate': slutt.isoformat(),
                'dimensions': dims, 'rowLimit': 500}
        url = ('https://searchconsole.googleapis.com/webmasters/v3/sites/'
               + site.replace(':', '%3A').replace('/', '%2F') + '/searchAnalytics/query')
        svar = http(url, tok, body)
        rader = svar.get('rows', [])
        fil = f'reports/gsc-{kort}.json'
        with open(fil, 'w') as f:
            json.dump({'site': site, 'dager': dager, 'dimensjoner': dims, 'rader': rader}, f,
                      ensure_ascii=False, indent=2)
        print(f'\n=== {kort}: {len(rader)} rader → {fil} ===')
        if svar.get('error'):
            print('   feil:', svar['error'].get('message'))
        for r in rader[:20]:
            print(f"  {int(r['clicks']):>4} klikk {int(r['impressions']):>6} visn  "
                  f"pos {r['position']:.1f}  {' · '.join(r['keys'])[:90]}")


if __name__ == '__main__':
    main()
