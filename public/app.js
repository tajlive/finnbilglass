/* Finnbilglass.no — frontend-flyt.
   Flyt: skiltnummer (foto/skriv) → glassvalg (bil-info + glasstype) → utstyrs-spørsmål → resultat (API) → tomt.
   API: POST /api/frontrute { merke, modell, aar, profil:{sensor,antenne} }
        POST /api/regnr      { regnr }   ← ALLE skiltnummer lagres (læring).
   Mock-fallback KUN ved file:// (offline demo), tydelig merket som DEMO. */
(function () {
  'use strict';

  var state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '', vin: null, forstegangsregistrert: null, import: false, importLand: null, resolver: null };
  var spm = [
    { key: 'sensor',     tittel: 'Har bilen regnsensor?', hjelp: 'Da starter viskerne automatisk når det regner.' },
    { key: 'antenne',    tittel: 'Har bilen radioantenne i frontruten?', hjelp: 'Usikker? Velg «Vet ikke». Vi dobbeltsjekker før sending.' },
    { key: 'coated',     tittel: 'Har frontruten et sol- eller varmedempende belegg?', hjelp: 'Dette er ofte vanskelig å se. Velg «Vet ikke» hvis du er usikker.' }
  ];
  var spmIndex = 0;

  function $(id) { return document.getElementById(id); }

  // ── Opplæringslogging (Tom 2026-08-17): ALLE valg og inntasting lagres.
  //    Session-id (localStorage) kobler hele kundereisen: søk → bekreft →
  //    utstyrs-svar → tilbehør. Bilder lagres separat (R2).
  //    Kundenes faktiske valg er fasit-signaler for opplæring av matcher/vision.
  var SESSION_KEY = 'fb-session-id';
  var sessionId = (function () {
    try {
      var s = localStorage.getItem(SESSION_KEY);
      if (!s) {
        s = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(SESSION_KEY, s);
      }
      return s;
    } catch (e) { return 's-' + Date.now().toString(36); }
  })();

  function bilKontekstLogg() {
    var ctx = {};
    if (state.regnr) ctx.regnr = state.regnr;
    if (state.vin) ctx.vin = state.vin;
    if (state.merke) { ctx.merke = state.merke; ctx.modell = state.modell; ctx.aar = state.aar; }
    return ctx;
  }

  // Fire-and-forget: aldri blokkerende, feil svelges (logging må ikke knekke flyten).
  function loggHendelse(hendelse, data, resolverUtfall) {
    try {
      var body = { sessionId: sessionId, hendelse: hendelse, bil: bilKontekstLogg() };
      if (data !== undefined) body.data = data;
      if (resolverUtfall) body.resolverUtfall = resolverUtfall;
      fetch('/api/opplaering', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) {}
  }

  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
    if (id === 'start') {
      state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '', vin: null, forstegangsregistrert: null, import: false, importLand: null, resolver: null };
      $('start-feil').classList.add('hidden');
    }
    var el = $('screen-' + id);
    if (el) el.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function tomtVis(tittel, tekst) {
    $('tomt-tittel').textContent = tittel;
    $('tomt-tekst').textContent = tekst;
    show('tomt');
  }

  function formatPris(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('nb-NO', { maximumFractionDigits: 0 }) + ' kr';
  }

  // Kjennemerke-visning: "AJ95429" → "AJ 95429"
  function formatRegnr(n) {
    var ren = (n || '').toUpperCase().replace(/[\s\-–—.]+/g, '');
    var m = /^([A-Z]{2})(\d{4,5})$/.exec(ren);
    return m ? m[1] + ' ' + m[2] : ren;
  }

  // Dato-visning: "2005-04-20" → "20. april 2005"
  var MND = ['januar','februar','mars','april','mai','juni','juli','august','september','oktober','november','desember'];
  function formatDato(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? parseInt(m[3], 10) + '. ' + MND[parseInt(m[2], 10) - 1] + ' ' + m[1] : null;
  }

  // Side 2-detaljer: chassisnummer + førstegangsregistrering + import-merkelapp (fra SVV).
  // NB: VIN vises ikke lenger i UI (Tom 2026-08-17: «skal ikke være mulig å søke på VIN enda»).

  function visRegnr() {
    var t = state.regnr ? 'Kjennemerke: ' + state.regnr : '';
    var el = $('resultat-regnr');
    if (el) { el.textContent = t; el.classList.toggle('hidden', !t); }
  }

  // Live-formatering av skiltnummer: SU18018 → SU 18018 (norsk format: 2 bokstaver + 4–5 siffer).
  // Formateres mens kunden skriver — reduserer tastefeil og ser proft ut.
  $('input-regnr').addEventListener('input', function () {
    var v = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
    var m = /^([A-Z]{2})(\d{0,5})$/.exec(v);
    var f = m ? (m[2] ? m[1] + ' ' + m[2] : m[1]) : v;
    if (this.value !== f) this.value = f;
  });

  // 1. Start: skiltnummer → SVV-oppslag (skiltnummer → bil). ALLE skiltnummer lagres (læring).
  //    Finner vi bilen → rett til bekreft. Finner vi den ikke → feilmelding med foto-forslag.
  $('form-regnr').addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = $('input-regnr').value.trim();
    if (!raw) return;
    var btn = this.querySelector('button');
    var orgTekst = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Søker etter bilen…';
    fetch('/api/regnr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regnr: raw, sessionId: sessionId })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        state.regnr = formatRegnr(raw);
        loggHendelse('sok_regnr', { regnr: raw, funnet: !!(d && d.bil && d.bil.merke) }, d && d.resolver ? d.resolver.utfall : null);
        if (d && d.bil && d.bil.merke) {
          settBilFraSvv(d.bil, d.resolver || null, raw);
        } else {
          visKontaktHandoff('Vi fant ikke bilen på «' + formatRegnr(raw) + '». Sjekk at skiltnummeret er riktig.');
        }
        visRegnr();
      })
      .catch(function () { visStartFeil('Noe gikk galt. Prøv igjen, eller ta bilde av skiltnummeret.'); })
      .finally(function () { btn.disabled = false; btn.textContent = orgTekst; });
  });

  // 1b. Foto av skiltnummeret → AI leser skiltet → SVV-oppslag (samme flyt som skrevet regnr).
  // Oppgave 7: klientside bildebehandling — EXIF-orientering, nedskalering, JPEG-komprimering,
  // thumbnail og kvalitetssjekk (lysstyrke/størrelse) FØR opplasting. HEIC konverteres til
  // JPEG av nettleseren (iOS Safari dekoder HEIC → canvas → JPEG) — Workers har ingen HEIC-dekoder.
  var MAX_BREDDE = 1920, THUMB_BREDDE = 320, KVALITET = 0.8;
  var LUMINANS_MIN = 55, MIN_BREDDE = 400;

  function komprimerBilde(fil) {
    return new Promise(function (resolve, reject) {
      function behandle(bmp) {
        try {
          var w = bmp.width, h = bmp.height;
          var skala = w > MAX_BREDDE ? MAX_BREDDE / w : 1; // forstørr aldri
          var fw = Math.round(w * skala), fh = Math.round(h * skala);
          var c = document.createElement('canvas');
          c.width = fw; c.height = fh;
          var cctx = c.getContext('2d');
          cctx.drawImage(bmp, 0, 0, fw, fh);
          var dataUrl = c.toDataURL('image/jpeg', KVALITET);
          var ts = w > THUMB_BREDDE ? THUMB_BREDDE / w : 1;
          var tc = document.createElement('canvas');
          tc.width = Math.round(w * ts); tc.height = Math.round(h * ts);
          tc.getContext('2d').drawImage(bmp, 0, 0, tc.width, tc.height);
          var thumbDataUrl = tc.toDataURL('image/jpeg', 0.7);
          var advarsler = [];
          try {
            var imgd = cctx.getImageData(0, 0, fw, fh).data;
            var sum = 0;
            for (var i = 0; i < imgd.length; i += 4) sum += 0.2126 * imgd[i] + 0.7152 * imgd[i + 1] + 0.0722 * imgd[i + 2];
            if (sum / (imgd.length / 4) < LUMINANS_MIN) advarsler.push('bildet er mørkt');
          } catch (e) { /* piksel-lesing utilgjengelig — hopp over luminans-sjekk */ }
          if (w < MIN_BREDDE) advarsler.push('lav oppløsning');
          resolve({ dataUrl: dataUrl, thumbDataUrl: thumbDataUrl, advarsler: advarsler });
        } catch (e) { reject(e); }
      }
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(fil).then(behandle).catch(function () {
          // Fallback: <img> + objectURL (eldre nettlesere uten createImageBitmap).
          var url = URL.createObjectURL(fil);
          var img = new Image();
          img.onload = function () { behandle(img); URL.revokeObjectURL(url); };
          img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bilde-feil')); };
          img.src = url;
        });
      } else {
        var url2 = URL.createObjectURL(fil);
        var img2 = new Image();
        img2.onload = function () { behandle(img2); URL.revokeObjectURL(url2); };
        img2.onerror = function () { URL.revokeObjectURL(url2); reject(new Error('bilde-feil')); };
        img2.src = url2;
      }
    });
  }

  function sendSkiltBilde(dataUrl, thumbDataUrl) {
    var btn = $('btn-foto-regnr');
    var org = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Leser skiltnummeret…';
    fetch('/api/les-skilt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, thumbnail: thumbDataUrl || null, sessionId: sessionId })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        loggHendelse('foto_skilt', { lest: d.regnr || null, funnet: !!(d && d.funnet) }, d && d.resolver ? d.resolver.utfall : null);
        if (d && d.ok && d.funnet && d.bil && d.bil.merke) {
          settBilFraSvv(d.bil, d.resolver || null, d.regnr);
        } else if (d && d.ok && !d.funnet) {
          visKontaktHandoff('Vi leste «' + formatRegnr(d.regnr) + '», men fant ikke bilen i Statens vegvesen.');
          $('input-regnr').value = formatRegnr(d.regnr);
        } else if (d && d.error) {
          visStartFeil(d.error);
        } else {
          visStartFeil('Kunne ikke lese skiltnummeret. Prøv igjen i bedre lys, uten reflekser.');
        }
      })
      .catch(function () { visStartFeil('Noe gikk galt. Prøv igjen, eller skriv skiltnummeret manuelt.'); })
      .finally(function () { btn.disabled = false; btn.innerHTML = org; });
  }

  $('btn-foto-regnr').addEventListener('click', function () { $('regnr-fil').click(); });
  $('regnr-fil').addEventListener('change', function () {
    var fil = this.files && this.files[0];
    this.value = '';
    if (!fil) return;
    if (!fil.type.startsWith('image/')) { visStartFeil('Filen må være et bilde.'); return; }
    if (fil.size > 20 * 1024 * 1024) { visStartFeil('Bildet er for stort (maks 20 MB).'); return; }
    komprimerBilde(fil)
      .then(function (res) {
        if (res.advarsler.length) {
          var fortsett = window.confirm('Bildekvaliteten er dårlig (' + res.advarsler.join(', ') + '). Vil du likevel sende dette bildet?');
          if (!fortsett) return;
        }
        sendSkiltBilde(res.dataUrl, res.thumbDataUrl);
      })
      .catch(function () { visStartFeil('Kunne ikke behandle bildet. Prøv et annet bilde.'); });
  });

  function visStartFeil(msg) {
    var el = $('start-feil');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // Felles: fyll state fra SVV-bil + resolver → vis glassvalg-skjermen (Tom: ingen bekreft-skjerm).
  // Bilmerke → logo-fil (public/bilmerker/<slug>.svg). Nominell varemerkebruk for å
  // identifisere bilens merke. Fallback: merketekst hvis logo mangler eller ikke lastes.
  // Dekker alle merkene i auto-glass.no-katalogen (Tom 2026-08-18).
  var MERKE_LOGO = {
    'ALFA': 'alfa-romeo',
    'ALFA ROMEO': 'alfa-romeo',
    'ASTON MARTIN': 'aston-martin',
    'AUDI': 'audi',
    'AUSTIN': 'austin',
    'BENTLEY': 'bentley',
    'BMW': 'bmw',
    'BORGWARD': 'borgward',
    'BUICK': 'buick',
    'BYD': 'byd',
    'CADILLAC': 'cadillac',
    'CHEVROLET': 'chevrolet',
    'CHRYSLER': 'chrysler',
    'CITROEN': 'citroen',
    'CITROËN': 'citroen',
    'CUPRA': 'cupra',
    'DACIA': 'dacia',
    'DAEWOO': 'daewoo',
    'DAIHATSU': 'daihatsu',
    'DODGE': 'dodge',
    'FERRARI': 'ferrari',
    'FIAT': 'fiat',
    'FORD': 'ford',
    'GINETTA': 'ginetta',
    'HONDA': 'honda',
    'HUMMER': 'hummer',
    'HYUNDAI': 'hyundai',
    'INFINITI': 'infiniti',
    'ISUZU': 'isuzu',
    'IVECO': 'iveco',
    'JAGUAR': 'jaguar',
    'JEEP': 'jeep',
    'KIA': 'kia',
    'LADA': 'lada',
    'LAMBORGHINI': 'lamborghini',
    'LANCIA': 'lancia',
    'LAND ROVER': 'land-rover',
    'LANDROVER': 'land-rover',
    'LEXUS': 'lexus',
    'LINCOLN': 'lincoln',
    'LOTUS': 'lotus',
    'MAN': 'man',
    'MASERATI': 'maserati',
    'MAXUS': 'maxus',
    'MAZDA': 'mazda',
    'MCLAREN': 'mclaren',
    'MERCEDES': 'mercedes-benz',
    'MERCEDES AMG': 'mercedes-benz',
    'MERCEDES-AMG': 'mercedes-benz',
    'MERCEDES-BENZ': 'mercedes-benz',
    'MG': 'mg',
    'MINI': 'mini',
    'MITSUBISHI': 'mitsubishi',
    'MORGAN': 'morgan',
    'NIO': 'nio',
    'NISSAN': 'nissan',
    'OPEL': 'opel',
    'PEUGEOT': 'peugeot',
    'POLESTAR': 'polestar',
    'PORSCHE': 'porsche',
    'RENAULT': 'renault',
    'ROLLS ROYCE': 'rolls-royce',
    'ROLLS-ROYCE': 'rolls-royce',
    'ROLLS-ROYCE MOTOR CARS': 'rolls-royce',
    'ROVER': 'rover',
    'SAAB': 'saab',
    'SCANIA': 'scania',
    'SEAT': 'seat',
    'SERES': 'seres',
    'SKODA': 'skoda',
    'SMART': 'smart',
    'SSANGYONG': 'ssangyong',
    'SUBARU': 'subaru',
    'SUZUKI': 'suzuki',
    'TESLA': 'tesla',
    'TOYOTA': 'toyota',
    'VAUXHALL': 'vauxhall',
    'VOLKSWAGEN': 'volkswagen',
    'VOLVO': 'volvo',
    'VOYAH': 'voyah',
    'VW': 'volkswagen',
    'VW NUTZFAHRZEUGE': 'volkswagen',
    'XPENG': 'xpeng'
  };

  // Pen skrivemåte: «VOLKSWAGEN TRANSPORTER» → «Volkswagen Transporter» (Tom 2026-08-18).
  // Beholder ekte forkortelser (CDI/TDI/AMG/VW), sifferkoder (208, XC90, W116) og
  // bindestreks-/-pluss-kjeder uendret i de delene som er koder.
  var BIL_FORKORTELSER = new Set([
    'CDI','TDI','TSI','TFSI','GTI','GTD','AMG','DCI','SDI','HDI','JTD','CRDI',
    'V8','V6','V12','V10','GT','RS','ST','GR','GTR','MPS','STI','WRX','NISMO','TRD',
    'EV','PHEV','4WD','AWD','4MOTION','XDRIVE','QUATTRO','4MATIC','BLUETEC','MAN','BYD',
    'BMW','GMC','JAC','DFSK','LPG'
  ]);
  // Kjente merker med spesiell skrivemåte (Tom 2026-08-18: «pent og moderne»).
  var MERKE_PENT = {
    'MCLAREN': 'McLaren', 'CITROEN': 'Citroën', 'CITROËN': 'Citroën',
    'SSANGYONG': 'SsangYong', 'LAND ROVER': 'Land Rover', 'LANDROVER': 'Land Rover',
    'ALFA ROMEO': 'Alfa Romeo', 'ASTON MARTIN': 'Aston Martin', 'ROLLS-ROYCE': 'Rolls-Royce',
    'ROLLS ROYCE': 'Rolls-Royce', 'ROLLS-ROYCE MOTOR CARS': 'Rolls-Royce', 'VW': 'VW'
  };
  function penSkrivemaate(s) {
    var key = String(s || '').toUpperCase().trim();
    if (MERKE_PENT[key]) return MERKE_PENT[key];
    return key.split(/([\s\-/+])/).map(function (del) {
      if (/^[\s\-/+]+$/.test(del)) return del;       // separator beholdes
      if (/\d/.test(del)) return del;                // sifferkoder: 208, XC90, W116, G-4
      var upper = del.toUpperCase();
      if (BIL_FORKORTELSER.has(upper)) return upper; // CDI, TDI, AMG, BMW…
      if (del.length <= 2) return upper;             // VW, MG, X, S
      return upper.charAt(0) + upper.slice(1).toLowerCase();
    }).join('');
  }

  // Viser bilmerkets logo i bilkortet; fallback til merketekst hvis logo ikke finnes.
  function visMerkeLogo(merke) {
    var el = $('glass-merkelbl');
    var key = (merke || '').toUpperCase().trim();
    var slug = MERKE_LOGO[key];
    if (!slug) { el.textContent = penSkrivemaate(key); return; }
    var img = document.createElement('img');
    img.className = 'bilkort-logo';
    img.src = '/bilmerker/' + slug + '.svg';
    img.alt = penSkrivemaate(key);
    img.onerror = function () { el.textContent = penSkrivemaate(key); };
    el.appendChild(img);
  }

  function settBilFraSvv(bil, resolver, regnr) {
    state.regnr = regnr ? formatRegnr(regnr) : '';
    state.merke = bil.merke;
    state.modell = bil.modell;
    state.aar = bil.aar;
    state.vin = bil.vin || null;
    state.forstegangsregistrert = bil.forstegangsregistrert || null;
    state.import = !!bil.import;
    state.importLand = bil.importLand || null;
    state.resolver = resolver || null;
    // P0 (Tom-doktrine): aldri generiske utstyrsspørsmål. Resolveren oppgir kun
    // skillende spørsmål (der en egenskap faktisk finnes som kandidatvariant OG
    // svaret skiller to kandidater). Mangler resolver/sporsmaal → 0 spørsmål
    // → trygg manuell kontroll («Jeg vil dobbeltsjekke riktig glass …»).
    settSpm(resolver && Array.isArray(resolver.sporsmaal) ? resolver.sporsmaal : []);
    $('glass-merkelbl').textContent = '';
    visMerkeLogo(state.merke);
    $('glass-bilnavn').textContent = penSkrivemaate(state.modell) + (state.aar ? ' · ' + state.aar : '');
    renderGlassDet();
    visRegnr();
    show('glass');
  }

  // Evidence Capture: supportdokumentasjon, separat fra beslutningsmotoren.
  // Ingen respons herfra brukes i resolveren eller kan sette EXACT.
  // Modernisert (Oppgave 7): klientside komprimering + EXIF-orientering +
  // thumbnail + kvalitetssjekk (lysstyrke/størrelse) FØR opplasting.
  $('btn-evidence-submit').addEventListener('click', function () {
    var felt = [
      ['plate', $('evidence-plate')],
      ['windshield', $('evidence-windshield')],
      ['mirror_sensor', $('evidence-mirror')],
      ['interior_optional', $('evidence-interior')]
    ];
    var valgt = felt.filter(function (p) { return p[1].files && p[1].files[0]; });
    var resultat = $('evidence-result');
    var settFeil = function (msg) { resultat.textContent = msg; resultat.classList.remove('hidden', 'ok'); };
    var settOk = function (msg) { resultat.textContent = msg; resultat.classList.remove('hidden'); resultat.classList.add('ok'); };
    if (!valgt.length) { settFeil('Velg minst ett bilde først.'); return; }
    if (!state.regnr) { settFeil('Søk opp bilen først — vi trenger registreringsskiltet for å knytte bildene til en sak.'); return; }
    var knapp = this;
    knapp.disabled = true;
    knapp.textContent = 'Klargjør bilder…';
    Promise.all(valgt.map(function (p) {
      var f = p[1].files[0];
      if (!f.type.startsWith('image/')) throw new Error('Filen må være et bilde.');
      if (f.size > 20 * 1024 * 1024) throw new Error('Et bilde er over 20 MB.');
      return komprimerBilde(f).then(function (res) {
        return { type: p[0], data: res.dataUrl, thumbnail: res.thumbDataUrl, advarsler: res.advarsler };
      });
    }))
      .then(function (bilder) {
        var adv = bilder.filter(function (b) { return b.advarsler.length; });
        if (adv.length) {
          var fortsett = window.confirm('Bildekvaliteten er dårlig for ' + adv.length + ' bilde(r) (' + adv[0].advarsler.join(', ') + '). Vil du likevel sende?');
          if (!fortsett) { knapp.disabled = false; knapp.textContent = 'Send bilder til support'; return null; }
        }
        knapp.textContent = 'Sender bilder…';
        return fetch('/api/evidence-capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ regnr: state.regnr, sessionId: sessionId, images: bilder.map(function (b) { return { type: b.type, data: b.data, thumbnail: b.thumbnail }; }) })
        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
      })
      .then(function (r) {
        if (r === null) return; // kunde avbrøt kvalitetssjekk
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || 'Kunne ikke sende bildene.');
        settOk('Takk. Support-sak ' + r.data.caseId + ' er opprettet. Dette påvirker ikke glassvalget.');
        valgt.forEach(function (p) { p[1].value = ''; });
        loggHendelse('evidence_capture_sent', { caseId: r.data.caseId, imageCount: r.data.imageCount });
      })
      .catch(function (e) { settFeil(e.message || 'Kunne ikke sende bildene. Prøv igjen.'); })
      .finally(function () { knapp.disabled = false; knapp.textContent = 'Send bilder til support'; });
  });

  // P2 (Beta1-funn): SVVs handelsbetegnelse inkluderer ofte merket («NISSAN
  // LEAF», «TOYOTA HILUX») — ikke prepender merket da. («NISSAN NISSAN LEAF»)
  function bilnavn() {
    var m = (state.merke || '').toUpperCase().trim();
    var mod = (state.modell || '').trim();
    var navn = (m && mod.toUpperCase().indexOf(m) !== 0 ? state.merke + ' ' : '') + mod;
    return navn + (state.aar ? ' ' + state.aar : '');
  }


  // Detaljlinjer fra SVV (førstegangsregistrert + VIN + import-merkelapp) på glassvalg-skjermen.
  function renderGlassDet() {
    var det = $('glass-det');
    det.classList.remove('hidden');
    det.innerHTML = '';
    if (state.forstegangsregistrert) {
      var r = document.createElement('div');
      r.className = 'detlinje';
      r.textContent = 'Førstegangsregistrert ' + state.forstegangsregistrert;
      det.appendChild(r);
    }
    if (state.vin) {
      var v = document.createElement('div');
      v.className = 'detlinje';
      v.textContent = 'VIN-nummer: ' + state.vin;
      det.appendChild(v);
    }
    if (state.import) {
      var imp = $('glass-import');
      imp.classList.remove('hidden');
      imp.textContent = '⚠️ importbil — importert fra ' + (state.importLand || 'utlandet');
    }
  }

  // Kjennemerke funnet ikke i SVV → ærlig melding + handoff til kontakt (ingen VIN/manuell — Tom 2026-08-17).
  function visKontaktHandoff(msg) {
    var el = $('start-feil');
    el.innerHTML = msg + ' <a href="mailto:support@finnbilglass.no" class="link">Send oss en e-post</a> eller ring <a href="tel:+4740408241" class="link">40 40 82 41</a> — så hjelper vi deg.';
    el.classList.remove('hidden');
  }

  // 3. Glassvalg → videre. VIN-søk og manuell inngang er fjernet (Tom 2026-08-17):
  //    skiltnummer (SVV) er eneste inngang; «Ikke min bil» → start; «Annet» → kontakt.
  $('btn-ikke-min-bil').addEventListener('click', function () {
    loggHendelse('ikke_min_bil', { merke: state.merke, modell: state.modell, regnr: state.regnr });
    show('start');
  });
  $('btn-annet').addEventListener('click', function () {
    loggHendelse('annet_glass', { merke: state.merke, modell: state.modell, regnr: state.regnr });
    window.location.href = 'mailto:support@finnbilglass.no?subject=' + encodeURIComponent('Annet glass — trenger hjelp');
  });

  // 4. Glasstype (kun frontrute er live i beta)
  document.querySelectorAll('.glassopt[data-type]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      if (b.dataset.type !== 'front') return; // kun frontrute er aktiv i beta
      loggHendelse('velg_frontrute', { merke: state.merke, modell: state.modell, regnr: state.regnr });
      spmIndex = 0;
      if (!spm.length) { gaaTilResultat(); return; } // ingen skillende spørsmål → direkte resultat
      spmRender();
      show('spm');
    });
  });

  // 5. Utstyrs-spørsmål — KUN funksjoner som faktisk skiller kandidatene stilles.
  //    Aldri spør om noe som ikke finnes som variant for bilen (Tom-doktrine).
  var SPM_DEF = {
    sensor:    { tittel: 'Har bilen regnsensor?', hjelp: 'Da starter viskerne automatisk når det regner.' },
    antenne:   { tittel: 'Har bilen radioantenne i frontruten?', hjelp: 'Usikker? Velg «Vet ikke». Vi dobbeltsjekker før sending.' },
    hud:       { tittel: 'Har bilen head-up display?', hjelp: 'Informasjon projiseres på frontruten foran sjåføren.' },
    kamera:    { tittel: 'Har bilen kamera bak speilet?', hjelp: 'For eksempel filholder, nødbrems eller skiltgjenkjenning.' },
    adas:      { tittel: 'Har bilen førerassistansesystemer?', hjelp: 'For eksempel nødbrems, filholder eller adaptiv cruise.' },
    coated:    { tittel: 'Har frontruten et sol- eller varmedempende belegg?', hjelp: 'Dette er ofte vanskelig å se. Velg «Vet ikke» hvis du er usikker.' },
    oppvarmet: { tittel: 'Har frontruten varmetråder i glasset?', hjelp: 'Oppvarmet frontrute har synlige tråder eller varmefelt i glasset.' }
  };

  function settSpm(funksjoner) {
    spm = (funksjoner || []).filter(function (f) { return SPM_DEF[f]; }).map(function (f) {
      return { key: f, tittel: SPM_DEF[f].tittel, hjelp: SPM_DEF[f].hjelp };
    });
  }

  function spmRender() {
    var q = spm[spmIndex];
    $('spm-teller').textContent = (spmIndex + 1) + '/' + spm.length;
    // Fremgangs-prikker
    var pp = $('framgang-punkter');
    if (pp) {
      pp.innerHTML = '';
      spm.forEach(function (_, i) {
        var dot = document.createElement('span');
        dot.className = 'fp' + (i < spmIndex ? ' ferdig' : i === spmIndex ? ' aktiv' : '');
        pp.appendChild(dot);
      });
    }
    $('spm-tittel').textContent = q.tittel;
    $('spm-hjelp').textContent = q.hjelp;
    var svar = $('spm-svar');
    svar.innerHTML = '';
    [['Ja', true], ['Nei', false]].forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'sek';
      b.textContent = p[0];
      b.addEventListener('click', function () { spmSvar(q.key, p[1]); });
      svar.appendChild(b);
    });
    $('btn-vetikke').classList.remove('hidden');
    $('btn-vetikke').onclick = function () { spmSvar(q.key, undefined); };
  }

  function spmSvar(key, val) {
    loggHendelse('spm_svar', { key: key, verdi: val === undefined ? 'vet_ikke' : val });
    if (key === 'sensor' || key === 'antenne' || key === 'coated') state.profil[key] = val;
    else state.info[key] = val; // hud / kamera / adas / oppvarmet: info i resultatet, ikke matcher-profilen
    if (spmIndex < spm.length - 1) { spmIndex++; spmRender(); return; }
    gaaTilResultat();
  }

  // Velg direkte blant resolver-kandidatene når de finnes; ellers /api/frontrute.
  function gaaTilResultat() {
    var valgt = filtrerResolverKandidater();
    if (valgt && renderResolverResultat(valgt)) return;
    show('resultat');
    lastResultat();
  }

  // Filtrer resolver-kandidater på kundens svar (kun besvarte funksjoner;
  // kandidat med ukjent verdi for funksjonen strykes ikke — vi vet ikke).
  function filtrerResolverKandidater() {
    var r = state.resolver;
    if (!r || !r.kandidater || !r.kandidater.length) return null;
    var svar = {};
    ['sensor', 'antenne', 'coated'].forEach(function (k) {
      if (state.profil[k] === true || state.profil[k] === false) svar[k] = state.profil[k];
    });
    ['hud', 'kamera', 'adas', 'oppvarmet'].forEach(function (k) {
      if (state.info[k] === true || state.info[k] === false) svar[k] = state.info[k];
    });
    var nokler = Object.keys(svar);
    if (!nokler.length) return r.kandidater;
    return r.kandidater.filter(function (k) {
      return nokler.every(function (nk) {
        var kv = k.attributter && k.attributter[nk];
        return kv == null || kv === svar[nk];
      });
    });
  }

  // Bygg resultat-visning direkte fra resolver-kandidater (ingen /api/frontrute-kall).
  // 1 kandidat → PINPOINT (pris direkte). Flere → prisspenn + varianter.
  function renderResolverResultat(kandidater) {
    if (!kandidater || !kandidater.length) return false;
    var en = kandidater.length === 1 ? kandidater[0] : null;
    var billigste = kandidater.slice().sort(function (a, b) {
      return (a.pris == null ? Infinity : a.pris) - (b.pris == null ? Infinity : b.pris);
    })[0];
    var valg = en || billigste;
    renderResultat({
      pinpoint: !!en,
      anbefaling: {
        varenr: valg.varenr,
        eurokode: valg.eurokode || null,
        pris: valg.pris != null ? valg.pris : null
      },
      kandidater: kandidater,
      meta: { resolver: true }
    });
    show('resultat');
    return true;
  }

  // 6. Resultat — kall Worker /api/frontrute.
  //    Mock KUN ved file:// (demo). På live: ærlig feilmelding, aldri oppdiktede treff.
  function lastResultat() {
    var body = { merke: state.merke, modell: state.modell, aar: state.aar, vin: state.vin, profil: state.profil };
    fetch('/api/frontrute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { renderResultat(data); })
      .catch(function () {
        if (window.location.protocol === 'file:') { renderResultat(mock()); return; }
        tomtVis('Noe gikk galt', 'Vi kunne ikke hente glasset akkurat nå. Prøv igjen om litt.');
      });
  }

  function lblEgenskap(e) {
    var map = { coated: 'sol-/varmedempende belegg', sensor: 'regnsensor', antenne: 'antenne i glasset', solar: 'solbeskyttelse',
      oppvarmet: 'oppvarmet', elektrisk: 'elektrisk', innkapslet: 'innkapslet', sensorgel: 'sensorfeste' };
    return map[e] || e;
  }

  // Variant på folkemål — kunden skal forstå forskjellen uten varenr eller fagbegreper.
  function beskrivVariant(k) {
    var a = k.attributter || {};
    var deler = [];
    if (a.sensor) deler.push('med regnsensor');
    if (a.kamera) deler.push('med kamera');
    if (a.adas) deler.push('med førerassistansesystem');
    if (a.coated) deler.push('med sol-/varmedempende belegg');
    if (a.hud) deler.push('med head-up-display');
    if (a.antenne) deler.push('med antenne i glasset');
    if (a.oppvarmet) deler.push('oppvarmet');
    if (a.acoustic) deler.push('lyddempet');
    if (deler.length) return deler.join(', ');
    var e = (k.egenskaper || []).map(lblEgenskap).join(', ');
    if (e) return e;
    var navn = (k.varenavn || '').trim();
    return navn || null;
  }

  function prisData(data, anbefaling) {
    var kandidater = Array.isArray(data && data.kandidater) ? data.kandidater : [];
    var priser = kandidater
      .map(function (k) { return k && typeof k.pris === 'number' ? k.pris : null; })
      .filter(function (p) { return p != null; });
    var harResolver = !!(data && data.meta && data.meta.resolver);
    if (data && data.pinpoint && anbefaling && anbefaling.pris != null) {
      return { label: 'Pris inkl. mva', verdi: formatPris(anbefaling.pris) };
    }
    if (harResolver && priser.length > 1) {
      var min = Math.min.apply(Math, priser);
      var max = Math.max.apply(Math, priser);
      if (min === max) return { label: 'Pris inkl. mva', verdi: formatPris(min) };
      return { label: 'Pris avhenger av variant', verdi: formatPris(min) + '–' + formatPris(max) };
    }
    if (anbefaling && anbefaling.pris != null) {
      return { label: harResolver ? 'Nærmeste pris inkl. mva' : 'Pris inkl. mva', verdi: formatPris(anbefaling.pris) };
    }
    return { label: 'Pris', verdi: 'Pris på forespørsel' };
  }

  function renderResultat(data) {
    visRegnr();
    // P0.1: tilbehørsseksjonen vises ikke generisk — kun per kandidat/glass (nedenfor).
    // Forhåndsutfyll henvendelsesskjema med skiltnummeret (låst) — beta-tilbudsflyt.
    $('inquiry-regnr').value = state.regnr || '';
    var a = data && data.anbefaling;
    if (!a) {
      tomtVis('Fant ingen treff', 'Vi fant ikke noe glass for denne bilen i katalogen. Kontakt oss så hjelper vi deg manuelt.');
      return;
    }
    var st = $('resultat-status');
    if (data.pinpoint) {
      st.textContent = 'Dette er vårt beste forslag basert på bilen din. En av våre fagfolk kontrollerer valget manuelt og bekrefter riktig glass og pris før noe bestilles.';
      st.className = 'note status pinpoint';
    } else if (data && data.meta && data.meta.resolver) {
      st.textContent = 'Disse variantene kan passe din bil. Riktig valg avhenger av utstyr og sensorer, og bekreftes alltid manuelt av en fagperson før noe bestilles.';
      st.className = 'note status verify';
    } else {
      st.textContent = 'Vi har funnet beste kandidat ut fra bildataene dine. En fagperson kontrollerer valget manuelt før sending.';
      st.className = 'note status';
    }
    st.classList.remove('hidden');

    var kort = $('resultat-kort');
    kort.innerHTML =
      '<div class="tag">Frontrute' + (data.demoData ? ' <span class="demo">DEMO</span>' : '') + '</div>' +
      '<div class="name"></div>' +
      '<div class="meta"></div>' +
      '<div class="spec"></div>';
    kort.querySelector('.name').textContent =
      bilnavn();
    kort.querySelector('.meta').textContent =
      'Varenr. ' + (a.varenr || '') + (a.eurokode ? ' · ' + a.eurokode : '');

    var specs = [];
    if (state.profil.sensor === true) specs.push('med regnsensor');
    if (state.profil.sensor === false) specs.push('uten regnsensor');
    if (state.profil.antenne === true) specs.push('med antenne i glasset');
    if (state.profil.coated === true) specs.push('med sol-/varmedempende belegg');
    if (state.profil.coated === false) specs.push('uten sol-/varmedempende belegg');
    if (state.info.adaskamera === true) specs.push('med kamera/førerassistansesystem');
    if (state.info.oppvarmet === true) specs.push('oppvarmet');
    kort.querySelector('.spec').textContent = specs.join(' · ');

    var pris = prisData(data, a);
    $('resultat-prislbl').textContent = pris.label;
    $('resultat-pris').textContent = pris.verdi;

    var alt = $('resultat-alt');
    alt.innerHTML = '';
    if (data.kandidater && data.kandidater.length > 1 && !data.pinpoint) {
      var intro = document.createElement('p');
      intro.className = 'varianter-intro';
      intro.textContent = 'Flere varianter av frontruten finnes til din bil. Riktig variant avhenger av utstyret bilen ble levert med. Vi finner den riktige for deg — du trenger ikke velge selv.';
      alt.appendChild(intro);
      data.kandidater.slice(1, 4).forEach(function (k) {
        var row = document.createElement('div');
        row.className = 'alt-row';
        var pris = document.createElement('span');
        pris.className = 'alt-pris';
        pris.textContent = formatPris(k.pris);
        row.appendChild(pris);
        var beskrivelse = beskrivVariant(k);
        if (beskrivelse) {
          var txt = document.createElement('span');
          txt.className = 'alt-beskrivelse';
          txt.textContent = beskrivelse;
          row.appendChild(txt);
        }
        alt.appendChild(row);
      });
      var avslutning = document.createElement('p');
      avslutning.className = 'varianter-avslutning';
      avslutning.textContent = 'Vi dobbeltsjekker riktig variant manuelt for bilen din før levering.';
      alt.appendChild(avslutning);
    }

    // P0.1 (Tom-doktrine): tilbehør er kandidat- og glassstyrt via
    // /api/accessories (AccessoryApplicabilityEngine som fasit).
    var tilbehorSeksjon = $('tilbehor-seksjon');
    var verifyTekst = $('tilbehor-verify');
    var montasjeValg = $('montasje-valg');
    if (data.pinpoint && a && a.varenr) {
      // PINPOINT: hent tilbehør for den ene kandidaten (engine som fasit).
      verifyTekst.classList.add('hidden');
      hentOgVisTilbehor(a, 'EXACT');
    } else if (data.kandidater && data.kandidater.length > 1) {
      // VERIFY: aldri kandidatspesifikke valg — kun trygg tekst.
      tilbehorData = [];
      $('tilbehor-liste').innerHTML = '';
      if (montasjeValg) montasjeValg.style.display = 'none';
      verifyTekst.classList.remove('hidden');
      tilbehorSeksjon.classList.remove('hidden');
    } else {
      // FALLBACK/tomt: ingen dokumentert tilbehør → ingen seksjon.
      tilbehorData = [];
      tilbehorSeksjon.classList.add('hidden');
      verifyTekst.classList.add('hidden');
    }
  }

  // ── P0.1: tilbehør (kandidat- og glassstyrt, engine som fasit) ─────────
  var tilbehorData = null; // siste /api/accessories-svar (re-render ved montasjevalg)

  function tilbehorInfoTekst(state) {
    if (state === 'REQUIRED_SEPARATE') return 'Dette trenger bilen din for riktig montering.';
    if (state === 'INCLUDED_WITH_GLASS') return 'Dette følger med glasset.';
    return null;
  }

  function renderTilbehor(accessories) {
    var seksjon = $('tilbehor-seksjon');
    var liste = $('tilbehor-liste');
    var verify = $('tilbehor-verify');
    var montasjeRadio = document.querySelector('input[name="montasje"]:checked');
    var montasje = montasjeRadio ? montasjeRadio.value : 'verksted';
    liste.innerHTML = '';
    verify.classList.add('hidden');
    if (!accessories || !accessories.length) { seksjon.classList.add('hidden'); return; }
    var visbare = 0;
    var harLimKit = false;
    accessories.forEach(function (a) {
      var info = tilbehorInfoTekst(a.state);
      if (info) {
        // REQUIRED / INCLUDED → informasjon, aldri avkrysningsboks.
        var rad = document.createElement('p');
        rad.className = 'tilbehor-info';
        rad.textContent = a.accessory.name + ' — ' + info;
        liste.appendChild(rad);
        visbare++;
        return;
      }
      if (a.state === 'OPTIONAL_COMPATIBLE') {
        // Lim-kit (INSTALLATION_CONSUMABLE) kun ved eksplisitt selvmontasje.
        if (a.accessory.kind === 'INSTALLATION_CONSUMABLE') {
          harLimKit = true;
          if (montasje !== 'selv') return;
        }
        var lbl = document.createElement('label');
        lbl.className = 'tilbehor-valg';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = a.accessory.productId;
        cb.addEventListener('change', function () {
          loggHendelse('tilbehor_valg', { valg: cb.value, avkrysset: cb.checked });
        });
        lbl.appendChild(cb);
        var span = document.createElement('span');
        span.textContent = a.accessory.name;
        lbl.appendChild(span);
        liste.appendChild(lbl);
        visbare++;
      }
      // NOT_APPLICABLE / UNKNOWN / AMBIGUOUS / EXCLUDED → aldri vist.
    });
    if (!visbare) { seksjon.classList.add('hidden'); return; }
    seksjon.classList.remove('hidden');
    var mv = $('montasje-valg');
    if (mv) mv.style.display = harLimKit ? '' : 'none';
  }

  function hentOgVisTilbehor(kandidat, fitmentStatus) {
    var features = {};
    if (kandidat && kandidat.attributter) {
      ['sensor', 'antenne', 'hud', 'kamera', 'adas', 'coated'].forEach(function (f) {
        if (kandidat.attributter[f] === true || kandidat.attributter[f] === false) features[f] = kandidat.attributter[f];
      });
    }
    fetch('/api/accessories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ varenr: kandidat.varenr || null, eurokode: kandidat.eurokode || null, features: features, fitmentStatus: fitmentStatus })
    }).then(function (r) { return r.json(); }).then(function (d) {
      tilbehorData = (d && d.ok) ? d.accessories : [];
      renderTilbehor(tilbehorData);
    }).catch(function () {
      tilbehorData = [];
      renderTilbehor(tilbehorData);
    });
  }

  // Montasjevalg (verksted/selv) → re-render: lim-kit vises kun ved selvmontasje.
  document.querySelectorAll('input[name="montasje"]').forEach(function (r) {
    r.addEventListener('change', function () { renderTilbehor(tilbehorData || []); });
  });

  function mock() {
    // Demo-fasit (verifisert katalogdata, finnbilglass-db): VW TRANSPORTER T5 2003- →
    // 8579AGSGYAVZ1B, listepris 9 980 → tier 5 490 kr.
    // KUN tilgjengelig ved file:// (offline demo).
    return {
      demoData: true,
      anbefaling: { varenr: '8579AGSGYAVZ1B', eurokode: '8579AGSGYAVZ1B', pris: 5490 },
      kandidater: [
        { varenr: '8579AGSGYAVZ1B', pris: 5490 },
        { varenr: '8579ACSGYAVZ1B', pris: 8490 }
      ]
    };
  }

  // Tilbake / nytt søk
  document.querySelectorAll('[data-tilbake]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-tilbake');
      loggHendelse('nytt_sok');
      show(t === 'spm' ? 'start' : t); // «Nytt søk» fra resultat → start
    });
  });

  // Tilbehørsvalg bindes dynamisk i renderTilbehor (P0.1) — ingen statiske bokser.

  // Beta-henvendelse: knapp → skjema → validering → POST → bekreftelse.
  $('btn-inquiry').addEventListener('click', function () {
    $('inquiry-form').classList.remove('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('inquiry-feil').classList.add('hidden');
  });

  function inquiryFeil(msg) {
    var el = $('inquiry-feil');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // Enkel regex: ser ut som telefon (minst 8 siffer) ELLER e-post (inneholder @ og .).
  function gyldigKontakt(s) {
    var v = (s || '').trim();
    if (!v) return false;
    var sifre = v.replace(/[^0-9]/g, '');
    if (sifre.length >= 8) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  $('btn-inquiry-send').addEventListener('click', function () {
    var regnr = $('inquiry-regnr').value.trim();
    var navn = $('inquiry-navn').value.trim();
    var kontakt = $('inquiry-kontakt').value.trim();
    var melding = $('inquiry-melding').value.trim();
    if (!navn || navn.length < 2) { inquiryFeil('Skriv inn navnet ditt (minst 2 tegn).'); return; }
    if (!gyldigKontakt(kontakt)) { inquiryFeil('Skriv inn en gyldig telefon eller e-post.'); return; }
    if (melding.length > 500) { inquiryFeil('Meldingen er for lang (maks 500 tegn).'); return; }
    var knapp = this;
    var org = knapp.textContent;
    knapp.disabled = true;
    knapp.textContent = 'Sender…';
    loggHendelse('tilbud_foresporsel', { regnr: regnr, navnLengde: navn.length, kontaktType: /@/.test(kontakt) ? 'epost' : 'telefon' });
    fetch('/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regnr: regnr, navn: navn, kontakt: kontakt, melding: melding, sessionId: sessionId })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || 'Kunne ikke sende forespørselen.');
        $('inquiry-form').classList.add('hidden');
        var b = $('inquiry-bekreftet');
        b.textContent = 'Takk! Vi har mottatt forespørselen og en fagperson kontakter deg for å bekrefte glass og pris.';
        b.className = 'note status pinpoint';
        b.classList.remove('hidden');
      })
      .catch(function (e) { inquiryFeil(e.message || 'Kunne ikke sende forespørselen. Prøv igjen.'); })
      .finally(function () { knapp.disabled = false; knapp.textContent = org; });
  });

  // Service worker: cache-first statisk + network-first HTML (80 % mobil = raske gjentatte besøk).
  // Kun https (aldri file://-demo). Registreres etter load for ikke å konkurrere med første maling.
  if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* ikke-kritisk */ });
    });
  }
})();
