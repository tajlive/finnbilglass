/**
 * accessory-v1/audit — tilbehørs-audit av nåværende UI/data (2026-08-18).
 * Ingen prod-UI-endringer i R1. Eksakte funn med fil/linje.
 */
export interface AccessoryAuditFinding {
  id: string;
  location: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  violation: string;
  evidence: string;
}

export function auditCurrentUiFindings(): AccessoryAuditFinding[] {
  return [
    {
      id: 'AUD-01',
      location: 'public/index.html:244-264',
      severity: 'HIGH',
      violation: '§11/§13: tilbehør spørres om UTEN bekreftet applikabilitet — «Trenger du tilbehør til monteringen?» viser sika-pakke/klips/pyntelist/sensorgel for ALLE glass uavhengig av kjøretøy/glass.',
      evidence: '4 ubetingede checkbokser (sika-pakke, klips, pyntelist, sensorgel) i tilbehørsseksjonen; ingen betingelse på valgt glass.',
    },
    {
      id: 'AUD-02',
      location: 'public/index.html:247-249',
      severity: 'MEDIUM',
      violation: '§16: Sika monteringspakke er INSTALLATION_CONSUMABLE men presenteres som om den er valgfri «tilbehør» — ikke merket som generisk forbruksvare.',
      evidence: '«Sika monteringspakke — rutelim, primer og Q-tips» uten skille konsumable/fitment-accessory.',
    },
    {
      id: 'AUD-03',
      location: 'public/index.html:251-254',
      severity: 'HIGH',
      violation: '§13/§11: «Klips / festeklips» antas for alle — men T5-frontrute (2525GYA, EMB=101) har innkapslet list og ingen klips-relasjon dokumentert i gt-auto-prislisten.',
      evidence: '0 klips-rader for T5/TRANSPORTER i data/gt-ekspansjon/prisliste-alle-glass.json; klips tilbys likevel for alle.',
    },
    {
      id: 'AUD-04',
      location: 'public/index.html:256-259',
      severity: 'HIGH',
      violation: '§13: «Pyntelist» tilbys for alle — ingen dokumentert pyntelist-relasjon for de fleste moderne glass; EMB=101-glass har list inkludert (duplikat-salg-risiko).',
      evidence: '2525GYA kommentar «EMB=101» = innkapslet list; pyntelist-checkboks tilbys likevel.',
    },
    {
      id: 'AUD-05',
      location: 'public/index.html:261-264',
      severity: 'MEDIUM',
      violation: '§13/§12: «Regnsensorgel / sensorfeste» tilbys for alle — men sensorgel er kun relevant for sensor-glass (feature-betinget) og ekspert-regelen er PROVISIONAL.',
      evidence: 'Sensorgel-relasjon krever sensor=true; checkboks vises uten feature-sjekk.',
    },
    {
      id: 'AUD-06',
      location: 'public/app.js:658-659',
      severity: 'MEDIUM',
      violation: '§20: tilbehørsvalg leses direkte fra checkbox-verdier uten applikabilitets-engin — kunden kan velge inkompatible komponenter.',
      evidence: '«Tilbehørsvalg (Sika/klips/pyntelist/sensorgel) — fasit for tilbehørs-modellen» samler alle avhukede verdier uten filtrering.',
    },
    {
      id: 'AUD-07',
      location: 'public/app.js:515',
      severity: 'LOW',
      violation: '§9: kun 4 tilbehørskategorier modellert (oppvarmet/elektrisk/innkapslet/sensorgel) — mangler clips/mouldings/trim/camera bracket/adas/retainers.',
      evidence: 'Feature-mapping dekker 4 av 12 kategorier.',
    },
    {
      id: 'AUD-08',
      location: 'data/gt-ekspansjon/prisliste-alle-glass.json',
      severity: 'LOW',
      violation: '§13/§10: tilbehør-rader finnes (163) men er IKKE koblet til frontrute-valg i UI-et — relasjonene eksisterer kun som katalograder.',
      evidence: '163 klips/PY/GU-rader med eurokode; ingen konsument av relasjonene i kundeflyten.',
    },
  ];
}
