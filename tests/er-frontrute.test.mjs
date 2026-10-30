// Regresjonstest: erFrontrute må avvise SIDE-/BAK-glass — også med 3-sifret eurokode-prefiks.
// Rotårsak 2026-08-16: regex krevde 4–5 sifre («^(\d{4,5})([A-Z])»), så «538LRG…» (CLA-siderute)
// og «671R…» (911-siderute) slapp gjennom som frontrute → 31 feilaktige GT-rader i prod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erFrontrute } from '../scripts/gt-generator.mjs';

test('sideglass 3-sifret prefiks + L → ikke frontrute (CLA 30199GN)', () => {
  assert.equal(erFrontrute('MERCEDES CLA 13-19', '30199GN', '538LRGSC4RVWZ1M'), false);
});

test('sideglass 3-sifret prefiks + R → ikke frontrute (911 21438GN)', () => {
  assert.equal(erFrontrute('PORSCHE 911 98-', '21438GN', '671RGNC2FV'), false);
});

test('bakrute 4-sifret prefiks + B → ikke frontrute (SIGMA 1747BZB)', () => {
  assert.equal(erFrontrute('MITSUBISHI SIGMA 77-', '1747BZB', '5636BZBL'), false);
});

test('sideglass 5-sifret prefiks + L → ikke frontrute (SPACE RUNNER 1766BY)', () => {
  assert.equal(erFrontrute('MITSUBISHI SPACE RUNNER', '1766BY', '26270LFWX-BYN'), false);
});

test('frontrute A-posisjon → frontrute (8579AGSGYAVZ1B)', () => {
  assert.equal(erFrontrute('VW TRANSPORTER T5 03-15', '8579AGSGYAVZ1B', '8579AGSGYAVZ1B'), true);
});

test('frontrute 3-sifret prefiks + A → frontrute (CLA 3172-serien)', () => {
  assert.equal(erFrontrute('MERCEDES CLA 13-19', '5381AGAACMVW1B', '5381AGAACMVW1B'), true);
});

test('veteran 2-sifret kode faller gjennom → frontrute-kandidat («42C»)', () => {
  assert.equal(erFrontrute('GAMMEL BIL 1960', '42C', '42C'), true);
});

test('SOLTAK-keyword → ikke frontrute (AUDI A2 soltak)', () => {
  assert.equal(erFrontrute('AUDI A2 00-05 SOLTAK', '8562GBZH5', '8Z0877055'), false);
});

test('PAKNING-keyword → ikke frontrute (AUDI A6 pakning)', () => {
  assert.equal(erFrontrute('AUDI A6 4B 97-04 PAKNING SOLTAK', '8589GZPE5', '8K9877071'), false);
});

test('SIDORUTA (svensk) → ikke frontrute (SUZUKI SJ410)', () => {
  assert.equal(erFrontrute('SUZUKI SJ410 85- SIDORUTA CL VS+HS', '10054CL', '8005FCLR3RQ'), false);
});

test('F-posisjon (ventilrute) → ikke frontrute', () => {
  assert.equal(erFrontrute('SUZUKI SJ410 85-', '10054CL', '8005FCLR3RQ'), false);
});

test('S-posisjon (siderute) → ikke frontrute', () => {
  assert.equal(erFrontrute('VOLVO S60 01-', '1234SGN', '5321SGNC1'), false);
});

test('«BYTTNR»-plassholder (ikke eurokode) faller gjennom → frontrute-kandidat', () => {
  assert.equal(erFrontrute('FORD TRANSIT 86-99 FRONTRUTE EL.', '1456GYEL', 'BYTTNR'), true);
});

test('«VENT» må IKKE treffe «VENTURE» (modellnavn) → frontrute-kandidat', () => {
  assert.equal(erFrontrute('CHEVROLET VENTURE 97-', 'W1454GB', '6281AGNBLVZ'), true);
});

test('«VENT» alene (ventilrute) → ikke frontrute — posisjon A isolerer keywordet', () => {
  assert.equal(erFrontrute('FORD ESCORT VENT 80-', '1310CL', '5453ACL'), false);
});

test('«HATCH» må IKKE treffe «HATCHBACK» → frontrute-kandidat', () => {
  assert.equal(erFrontrute('FORD FIESTA HATCHBACK 89-', '1440GN', '5137AGN'), true);
});

test('«ALLE MOD» er fjernet — MAZDA 323 ALLE MOD med posisjon A → frontrute-kandidat', () => {
  assert.equal(erFrontrute('MAZDA 323 ALLE MOD 86-89', '1413BL', '5125ABL'), true);
});

test('K-suffiks = KLIPS-KIT (ikke glass): MERCEDES 190 KLIPS KIT', () => {
  assert.equal(erFrontrute('MERCEDES 190+190E 85- KLIPS KIT', '1400K', '10012K'), false);
});

test('K-suffiks = KLIPS (ikke glass): NISSAN STANZA KLIPS', () => {
  assert.equal(erFrontrute('NISSAN STANZA KLIPS', '1207K', '10011K'), false);
});

test('K-suffiks = KLIPS FRONTRUTE-kit (ikke glass): KIA CREDOS', () => {
  assert.equal(erFrontrute('KIA CREDOS 97- KLIPS FRONTRUTE', '2052K', '10015K'), false);
});

test('Sensorgel-glass er EKTE glass (sensor-attributt, behold): VOLVO FH', () => {
  assert.equal(erFrontrute('VOLVO FH TRUCK 94-', '1892GNM', '1035AGNM'), true);
});

test('Sensortape-glass er EKTE glass (behold): AUDI A4 SENSORTAPE S2', () => {
  assert.equal(erFrontrute('AUDI A4 4D SEDAN 01- FRONTRUTE', '2324CSGY', '8579AGSCSGY'), true);
});

test('«ALLE MOD» er fjernet, men DØRRUTE fanger fortsatt (MAZDA 6 DØRRUTE)', () => {
  assert.equal(erFrontrute('MAZDA 6 ALLE MOD 13- DØRRUTE', '29969GN', '5180LGSS4FDW'), false);
});

// ── PY*/GU*-pyntelist-guard (Tom 2026-08-17, UR67407) ──
// PY/PYT/PYB/PYS/PYC/PYKIT = pyntelist (dekorlist rundt glasset som skjuler
// limfugen), GU/GUM = gummilist — IKKE glass. «1979PY» 625 kr er en list,
// riktig frontrute er 1979C 5 320 kr. YP*/YPC*/YPS*/YPL* er EKTE glass med
// list-attributt og skal BEHOLDES.

test('PY-suffiks → ikke frontrute (1979PY feilpris-variant)', () => {
  assert.equal(erFrontrute('MERCEDES SPRINTER 95-06 LAV MOD', '1979PY', '5426ASMV'), false);
});

test('PY-suffiks → ikke frontrute (1971PY feilpris-variant)', () => {
  assert.equal(erFrontrute('MERCEDES SPRINTER HØY 95-06', '1971PY', '5427ASMV'), false);
});

test('PYT-suffiks → ikke frontrute (1102PYT Mercedes W126 pyntelist)', () => {
  assert.equal(erFrontrute('MERCEDES W126 81-91 PYNTELIST', '1102PYT', '5931AKMSC'), false);
});

test('PYC-suffiks → ikke frontrute (1354PYC)', () => {
  assert.equal(erFrontrute('CITROEN BX 83- PYNTELIST', '1354PYC', '6519AKMC'), false);
});

test('PYKIT-suffiks → ikke frontrute (BMW X1 pyntelist-kit)', () => {
  assert.equal(erFrontrute('BMW X1 5D SUV 15- PYNTELIST KIT V+H FRONTRUTE', '3355PYKIT', '5174AKMS'), false);
});

test('GU-suffiks → ikke frontrute (540GU Mercedes W108 gummilist)', () => {
  assert.equal(erFrontrute('MERCEDES 250-300S W108 63-72 GUMMILIST FRONTRUT', '540GU', '108ACL'), false);
});

test('GUM-suffiks → ikke frontrute', () => {
  assert.equal(erFrontrute('SAAB 900 3D/5D/4D 79-92 GUMMILIST', '1018GUM', '7402AKMH'), false);
});

test('YP-suffiks er EKTE glass (list-attributt) → frontrute-kandidat', () => {
  assert.equal(erFrontrute('NISSAN 160J 2DV COUPE 78-81 FRONTRUTE+BL', '1004YP', '5401ABL'), true);
});

test('YPC-suffiks er EKTE glass (list-attributt) → frontrute-kandidat', () => {
  assert.equal(erFrontrute('FORD MONDEO 4D SE 07- FRONTRUTE+INNK+CROM LIST+SOTET', '28035YPC', '5439AGB'), true);
});

test('YPS-suffiks er EKTE glass (list-attributt) → frontrute-kandidat', () => {
  assert.equal(erFrontrute('FORD FOCUS 5D HBK 11- FRONTRUTE+INNK+SORT LIST+SOTET', '29487YPS', '5441AGB'), true);
});

test('YPL-suffiks er EKTE glass (list-attributt) → frontrute-kandidat', () => {
  assert.equal(erFrontrute('AUDI A8 4D SEDAN 03- FRONTRUTE LAMINERT VS+SOTET', '26303YPL', '5442AGB'), true);
});

test('riktige Sprinter-varianter er fortsatt frontruter (1979C/1971C/1979GY/1971GG)', () => {
  assert.equal(erFrontrute('MERCEDES SPRINTER (LAV TYPE)', '1979C', '5426ACL'), true);
  assert.equal(erFrontrute('MERCEDES SPRINTER', '1971C', '5427ACL1C'), true);
  assert.equal(erFrontrute('MERCEDES SPRINTER (LAV TYPE)', '1979GY', '5426AGNGY'), true);
  assert.equal(erFrontrute('MERC SPRINTER SKAPVOGN', '1971GG', '5427AGNGN1C'), true);
});

// KATEGORI-GUARD (2026-08-24): katalogens kategori er autoritativ når den finnes
// (auto-glass.no-scrape → catalog-prod.min.json.gz). Ukjent = tillatt (konservativ).
import { katalogErFrontrute } from '../scripts/gt-generator.mjs';

test('katalog-guard: sideglass (BMW E46 26229GN) → ikke frontrute', () => {
  assert.equal(katalogErFrontrute('26229GN'), false);
});

test('katalog-guard: bakrute (BMW E46 26231GN) → ikke frontrute', () => {
  assert.equal(katalogErFrontrute('26231GN'), false);
});

test('katalog-guard: bakrute (RAV4 8410GZPR5SR) → ikke frontrute', () => {
  assert.equal(katalogErFrontrute('8410GZPR5SR'), false);
});

test('katalog-guard: dørglass (VW Touareg 26014GN) → ikke frontrute', () => {
  assert.equal(katalogErFrontrute('26014GN'), false);
});

test('katalog-guard: kjent frontrute (3202GNM RAV4 13-) → frontrute', () => {
  assert.equal(katalogErFrontrute('3202GNM'), true);
});

test('katalog-guard: ukjent varenr → tillatt (konservativ, aldri blokker)', () => {
  assert.equal(katalogErFrontrute('9999XX'), true);
});
