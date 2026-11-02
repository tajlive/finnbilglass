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

## Viktige forbehold

1. **Fører/passasjer er ikke det samme som venstre/høyre.** Koden sier hvilken side av bilen glasset sitter på *sett fra bilens retning*. På venstrestyrte biler (Norge) er førerside = venstre side. På høyrestyrte biler er førerside = høyre side. Systemet skal derfor lagre **både** `side` (fører/passasjer) og `fysisk_side` (venstre/høyre) med kjøretøyets styretype som kontekst — aldri utlede det ene fra det andre uten dokumentert styretype.
2. **Typekoden beskriver posisjon, ikke utstyr.** Kamera, regnsensor, HUD og oppvarming står ikke i koden. De må komme fra egne kilder eller kundesvar.
3. **Typekoden identifiserer ikke kjøretøy.** Samme SKU kan ha typekode `F` og passe flere modeller; kjøretøytilknytning kommer fra applikasjonsdata.
4. **Delt bakrute (`BF`/`BP`)** finnes bare på 15 rader. Behandle som egen kategori, ikke som vanlig bakrute.
5. Kodene er hentet fra én leverandørkatalog. Ved konflikt mellom to kilder for samme varenummer skal konflikten registreres — ikke overskrives stille.
