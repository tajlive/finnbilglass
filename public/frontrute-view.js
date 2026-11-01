/**
 * Frontrute-resultatvisning — rene hjelpefunksjoner for kundeflaten.
 *
 * Ligger i egen fil (ikke i app.js) fordi disse reglene er de som avgjør hva
 * kunden får se: status, pris og hvilke kandidater som kan filtreres bort på
 * et utstyrssvar. Da kan de testes i Node uten nettleser.
 *
 * UMD: `window.FBGView` i nettleseren, `module.exports` i Node-testene.
 *
 * Prinsipper (Tom 2026-10-31):
 *   - Katalogtreff er aldri »bekreftet kompatibel».
 *   - HUD kan ikke leses av glasset; ukjent forblir ukjent.
 *   - Kandidater fjernes bare når datagrunnlaget faktisk skiller dem.
 *   - Pris vises bare når den er dokumentert; ellers «Pris på forespørsel».
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    root.FBGView = module.exports;
  } else root.FBGView = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SPORSMAL = {
    sensor: {
      tekst: 'Har bilen regnsensor?',
      hjelp: 'Viskerne starter av seg selv når det kommer vann eller snø på ruten.',
      ja: 'Ja, viskerne starter selv',
      nei: 'Nei, jeg starter viskerne selv'
    },
    kamera: {
      tekst: 'Har bilen kamera i frontruten?',
      hjelp: 'Et kamera bak speilet brukes av førerstøtte (filholder, nødbrems).',
      ja: 'Ja, det er kamera',
      nei: 'Nei, ikke kamera'
    },
    adas: {
      tekst: 'Har bilen førerstøtte som bruker kamera i ruten?',
      hjelp: 'For eksempel filholder eller automatisk nødbrems.',
      ja: 'Ja',
      nei: 'Nei'
    },
    hud: {
      tekst: 'Har bilen head-up-display?',
      hjelp: 'Fart og navigasjon projiseres som et bilde på ruten fra dashbordet.',
      ja: 'Ja, jeg ser projisert bilde',
      nei: 'Nei'
    },
    oppvarmet: {
      tekst: 'Har bilen oppvarmet frontrute?',
      hjelp: 'Det er en egen knapp for strøm til frontruten, eller synlige varmetråder.',
      ja: 'Ja, frontruten kan varmes opp',
      nei: 'Nei'
    },
    antenne: {
      tekst: 'Er det antenne i frontruten?',
      hjelp: 'Noen biler har radioantennen innebygd i glasset.',
      ja: 'Ja',
      nei: 'Nei',
      vetIkke: 'Vet ikke'
    },
    coated: {
      tekst: 'Har frontruten et sol-/varmereflekterende belegg?',
      hjelp: 'Belegget gir et svakt fargeskjær i ruten.',
      ja: 'Ja',
      nei: 'Nei',
      vetIkke: 'Vet ikke'
    }
  };

  function sporsmaalstekst(felt) {
    return (SPORSMAL[felt] && SPORSMAL[felt].tekst) || felt;
  }

  function sporsmaalHjelp(felt) {
    return (SPORSMAL[felt] && SPORSMAL[felt].hjelp) || null;
  }

  function svarAlternativer(felt) {
    var s = SPORSMAL[felt] || {};
    return [
      { verdi: 'ja', tekst: s.ja || 'Ja' },
      { verdi: 'nei', tekst: s.nei || 'Nei' },
      { verdi: 'vet-ikke', tekst: s.vetIkke || 'Vet ikke' }
    ];
  }

  function formatNok(tall) {
    if (typeof tall !== 'number' || !isFinite(tall) || tall <= 0) return null;
    return String(Math.round(tall)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** Pris som kan vises for kunden. `null` → «Pris på forespørsel». */
  function prisTekst(pris) {
    var nok = formatNok(pris);
    if (!nok) {
      return { tekst: 'Pris på forespørsel', usikker: true, visPris: false };
    }
    return {
      tekst: 'Fra ' + nok + ' kr',
      usikker: false,
      visPris: true,
      detalj: 'inkl. mva. Frakt og eventuell levering avklares i tilbudet.'
    };
  }

  /**
   * Status for resultatsteget.
   * Nye statuskoder per CTO-ordre V3.0 (2026-11-01):
   *   EXACT      — én kandidat med uavhengig evidens (OE/bilde/montør), klar for bestilling
   *   PROVISIONAL — én eller flere kandidater fra katalogen, mangler uavhengig bekreftelse
   *   AMBIGUOUS  — flere kandidater som skilles av utstyr, kunde må velge
   *   MANUAL_REVIEW — ingen pålitelig kandidat, manuell gjennomgang kreves
   *
   * Prinsipper:
   *   - Katalog alene gir aldri EXACT (krever uavhengig evidens).
   *   - PINPOINT fra resolver uten bekreftelse = PROVISIONAL, ikke EXACT.
   *   - VERIFY eller flere kandidater = AMBIGUOUS.
   *   - Ingen treff = MANUAL_REVIEW.
   * @param {string|null} utfall PINPOINT | VERIFY | FALLBACK | null
   * @param {number} antall antall kandidater
   * @param {boolean} harUavhengigEvidens om det finnes OE/bilde/montør-bekreftelse
   */
  function resultatStatus(utfall, antall, harUavhengigEvidens = false) {
    if (!antall) {
      return {
        kode: 'MANUAL_REVIEW',
        tittel: 'Vi fant ikke en sikker frontrute i katalogen akkurat nå',
        melding:
          'Vi kontrollerer manuelt hvilken frontrute bilen din bruker, og gir deg pris og levering før du bestemmer deg.',
        kanBestille: false,
      };
    }
    if (utfall === 'PINPOINT' && antall === 1 && harUavhengigEvidens) {
      return {
        kode: 'EXACT',
        tittel: 'Vi har identifisert én frontrute til bilen din',
        melding:
          'Glassmerkingen og bilens utstyr er bekreftet. Du kan fortsette med tilbud.',
        kanBestille: true,
      };
    }
    if (utfall === 'PINPOINT' && antall === 1 && !harUavhengigEvidens) {
      return {
        kode: 'PROVISIONAL',
        tittel: 'Vi har funnet en mulig frontrute til bilen din',
        melding:
          'Katalogen peker på én variant, men vi mangler uavhengig bekreftelse før vi kan garantere riktig glass.',
        kanBestille: false,
      };
    }
    if (utfall === 'VERIFY' || antall > 1) {
      return {
        kode: 'AMBIGUOUS',
        tittel: 'Vi har funnet flere mulige frontruter til bilen din',
        melding: 'Riktig variant avhenger av bilens utstyr. Velg alternativet som passer.',
        kanBestille: false,
      };
    }
    return {
      kode: 'MANUAL_REVIEW',
      tittel: 'Vi må kontrollere hvilken frontrute bilen bruker før vi kan bekrefte riktig glass',
      melding:
        'Opplysningene om bilen er ikke entydige nok til å peke på én frontrute. Vi kontrollerer manuelt og sender deg pris og levering.',
      kanBestille: false,
    };
  }

  /** Svar som kan gis på et spørsmål: 'ja' | 'nei' | 'vet-ikke'. */
  function svarTilBoolsk(svar) {
    if (svar === 'ja') return true;
    if (svar === 'nei') return false;
    return null;
  }

  /**
   * Filtrerer kandidater på kundens svar — men bare når svaret faktisk skiller.
   *
   * Ukjente attributter (null/undefined) gjør at kandidaten BEHOLDES. Hvis
   * filtreringen ville fjerne alle kandidater, returneres den opprinnelige
   * lista med `utilstrekkelig: true` — datagrunnlaget støtter ikke filtreringen.
   */
  function filtrerPaaSvar(kandidater, svar) {
    var liste = Array.isArray(kandidater) ? kandidater : [];
    var felter = Object.keys(svar || {});
    if (!felter.length) return { kandidater: liste, fjernet: 0, utilstrekkelig: false };

    var beholdt = liste.filter(function (k) {
      var a = (k && k.attributter) || {};
      for (var i = 0; i < felter.length; i++) {
        var felt = felter[i];
        var onske = svarTilBoolsk(svar[felt]);
        if (onske === null) continue; // «vet ikke» filtrerer aldri
        var faktisk = a[felt];
        if (typeof faktisk !== 'boolean') continue; // ukjent → ikke fjern
        if (faktisk !== onske) return false;
      }
      return true;
    });

    if (!beholdt.length) return { kandidater: liste, fjernet: 0, utilstrekkelig: true };
    return { kandidater: beholdt, fjernet: liste.length - beholdt.length, utilstrekkelig: false };
  }

  /** Korttekst for én kandidat. */
  function kandidatKort(kandidat) {
    var k = kandidat || {};
    var a = k.attributter || {};
    var egenskaper = [];
    if (a.oppvarmet === true) egenskaper.push('oppvarmet');
    if (a.sensor === true) egenskaper.push('regnsensor');
    if (a.kamera === true) egenskaper.push('kamera');
    if (a.adas === true) egenskaper.push('førerstøtte');
    if (a.coated === true) egenskaper.push('sol-/varmereflekterende');
    if (a.antenne === true) egenskaper.push('antenne');
    if (a.hud === true) egenskaper.push('head-up-display');
    return {
      varenr: k.varenr || null,
      navn: k.varenavn || 'Frontrute',
      pris: prisTekst(k.pris),
      egenskaper: egenskaper
    };
  }

  /** Tekst for totalantall når listen er kappet (VW: «Viser 6 av 7 mulige varianter»). */
  function antallTekst(antallVist, antallTotalt) {
    if (typeof antallTotalt !== 'number' || antallTotalt <= antallVist) return null;
    return 'Viser ' + antallVist + ' av ' + antallTotalt + ' mulige varianter';
  }

  return {
    SPORSMAL: SPORSMAL,
    sporsmaalstekst: sporsmaalstekst,
    sporsmaalHjelp: sporsmaalHjelp,
    svarAlternativer: svarAlternativer,
    formatNok: formatNok,
    prisTekst: prisTekst,
    resultatStatus: resultatStatus,
    filtrerPaaSvar: filtrerPaaSvar,
    kandidatKort: kandidatKort,
    antallTekst: antallTekst
  };
});
