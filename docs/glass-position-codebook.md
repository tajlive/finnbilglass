# Typekode- og plasseringskodebok

Kilde: `products-autoglass-no.csv` (auto-glass.no-katalogen), felt `type_code` og `type_code_desc`.
Verifisert mot faktiske rader: **18 distinkte koder** fordelt på 27 019 rader med typekode.

Kodene er *ikke* antatt — beskrivelsene under er hentet ordrett fra kildens eget beskrivelsesfelt.

| Kode | Rader | Betydning i kilden | Glassgruppe | Side | Ledd |
|---|---:|---|---|---|---|
| `F` | 6 945 | Frontrute | Frontrute | – | – |
| `B` | 3 913 | Bakrute | Bakrute | – | – |
| `DFF` | 2 438 | Dørrute fremre førerside | Dørrute | Fører | Fremre dør |
| `DFB` | 2 319 | Dørrute bakre førerside | Dørrute | Fører | Bakre dør |
| `DPF` | 2 200 | Dørrute fremre passasjerside | Dørrute | Passasjer | Fremre dør |
| `DPB` | 2 090 | Dørrute bakre passasjerside | Dørrute | Passasjer | Bakre dør |
| `SFB1` | 2 099 | Siderute bakre 1 førerside | Siderute | Fører | Bakre, posisjon 1 |
| `SPB1` | 1 888 | Siderute bakre 1 passasjerside | Siderute | Passasjer | Bakre, posisjon 1 |
| `DFBV` | 828 | Ventil/siderute bakre førerside | Ventilrute | Fører | Bakre |
| `DPBV` | 760 | Ventil/siderute bakre passasjerside | Ventilrute | Passasjer | Bakre |
| `DFFV` | 701 | Ventil/siderute fremre førerside | Ventilrute | Fører | Fremre |
| `DPFV` | 548 | Ventil/siderute fremre passasjerside | Ventilrute | Passasjer | Fremre |
| `SFB2` | 102 | Siderute bakre 2 førerside | Siderute | Fører | Bakre, posisjon 2 |
| `SPB2` | 83 | Siderute 2 bakre passasjerside | Siderute | Passasjer | Bakre, posisjon 2 |
| `SFB3` | 53 | Siderute 3 bakre førerside | Siderute | Fører | Bakre, posisjon 3 |
| `SPB3` | 37 | Siderute 3 bakre passasjerside | Siderute | Passasjer | Bakre, posisjon 3 |
| `BF` | 7 | Bakrute delt førerside | Bakrute (delt) | Fører | – |
| `BP` | 8 | Bakrute delt passasjerside | Bakrute (delt) | Passasjer | – |

## Oppbygning

- **Første bokstav:** `F` front, `B` bak, `D` dør, `S` siderute.
- **Andre bokstav:** `F`/`P` = fører/passasjer. `B` etter `D` (som i `DFB`) betyr *bakre dør*, ikke passasjer.
- **Tredje bokstav:** `F`/`B` = fremre/bakre ledd.
- **Suffiks `V`:** ventil-/trekantrute i samme posisjon. `DFFV` = fremre ventilrute førerside, `DFF` = fremre dørrute førerside. Disse må aldri forveksles: de er forskjellige fysiske glass.
- **Tall `1/2/3`:** posisjonsnummer bakover i bilen på sideruter.

## Tre opplysninger som må holdes fra hverandre

| Opplysning | Hva det er | Hvor det kommer fra |
|---|---|---|
| **Kildens side** | «fører» / «passasjer» — katalogens egen betegnelse | typekoden (auto-glass.no) |
| **Produktets fysiske side** | venstre / høyre — egenskap ved selve glasset | katalogens markedskonvensjon, ikke bilen |
| **Bilens styretype** | LHD / RHD / ukjent | kjøretøyopplysning, aldri produktet |

**Kritisk regel:** et venstre glass blir ikke et høyre glass fordi bilen har rattet
på høyre side. Det er samme fysiske produkt, men det havner på bilens
*passasjerside* i stedet for førersiden. Systemet speilvender derfor aldri en SKU.

Katalogen er norsk (LHD-marked), så «førerside» = fysisk venstre **som
markedsantakelse**. Antakelsen merkes alltid:

- `side_grunnlag: "ANTATT_LHD_MARKED"`
- `side_bekreftet: false`
- `produkt_fysisk_side_verifisert: null`

`rollePaBil(produktSide, kjorestyring)` gir hvilken rolle glasset får på en bil
med kjent styretype — ren visningsinformasjon, ingen endring av produktet.

Antakelsen kan brukes til forhåndsvalg, etiketter, sortering og færre
kontrollspørsmål. Den gir **aldri** EXACT.
2. **Typekoden beskriver posisjon, ikke utstyr.** Kamera, regnsensor, HUD og oppvarming står ikke i koden. De må komme fra egne kilder eller kundesvar.
3. **Typekoden identifiserer ikke kjøretøy.** Samme SKU kan ha typekode `F` og passe flere modeller; kjøretøytilknytning kommer fra applikasjonsdata.
4. **Delt bakrute (`BF`/`BP`)** finnes bare på 15 rader. Behandle som egen kategori, ikke som vanlig bakrute.
5. Kodene er hentet fra én leverandørkatalog. Ved konflikt mellom to kilder for samme varenummer skal konflikten registreres — ikke overskrives stille.
