/* Finnbilglass.no — frontend-flyt.
   Flyt: skiltnummer (foto/skriv) → glassvalg (bil-info + glasstype) → utstyrs-spørsmål → resultat (API) → tomt.
   API: POST /api/frontrute { merke, modell, aar, profil:{sensor,antenne} }
        POST /api/regnr      { regnr }   ← ALLE skiltnummer lagres (læring).
   Mock-fallback KUN ved file:// (offline demo), tydelig merket som DEMO. */
(function () {
  'use strict';

  var state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '', vin: null, forstegangsregistrert: null, import: false, importLand: null, resolver: null, currentGlassKind: null, glassRequest: null, clientRequestId: null, inquiryAttempted: false, preferredWindshieldCandidate: null, evidenceSent: false };
  var searchGeneration = 0;
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
    if (id !== 'resultat') searchGeneration++;
    if (id === 'start') {
      state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '', vin: null, forstegangsregistrert: null, import: false, importLand: null, resolver: null, currentGlassKind: null, glassRequest: null, clientRequestId: null, inquiryAttempted: false, preferredWindshieldCandidate: null, evidenceSent: false };
      $('start-feil').classList.add('hidden');
      $('inquiry-form').classList.add('hidden');
      $('inquiry-bekreftet').classList.add('hidden');
      $('inquiry-feil').classList.add('hidden');
      $('inquiry-navn').value = '';
      $('inquiry-kontakt').value = '';
      $('inquiry-telefon-ekstra').value = '';
      $('inquiry-kontaktpreferanse').value = 'telefon';
      oppdaterKontaktfelt();
      $('inquiry-melding').value = '';
      $('inquiry-glass-summary').textContent = '';
      $('inquiry-glass-summary').classList.add('hidden');
      document.querySelectorAll('.glassopt[data-type]').forEach(function (button) { button.classList.remove('aktiv'); button.setAttribute('aria-pressed', 'false'); });
    }
    var el = $('screen-' + id);
    if (el) el.classList.remove('hidden');
    // Bytt skjerm uten scroll-animasjon: kunden skal ikke oppleve et blink eller
    // at nettleseren navigerer til en annen side under registreringssøket.
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function tomtVis(tittel, tekst) {
    $('tomt-tittel').textContent = tittel;
    $('tomt-tekst').textContent = tekst;
    show('tomt');
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
      body: JSON.stringify({ regnr: raw, sessionId: sessionId, lookupOnly: true })
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

    // P1.1A – biler uten skilt: identifiser bilen, ikke glassvarianten.
    $('btn-uten-skilt').addEventListener('click', function () {
      var form = $('form-vin');
      var expanded = form.classList.contains('hidden');
      form.classList.toggle('hidden', !expanded);
      this.setAttribute('aria-expanded', String(expanded));
      if (expanded) $('input-vin').focus();
    });

    $('form-vin').addEventListener('submit', function (e) {
      e.preventDefault();
      var vin = $('input-vin').value.trim().toUpperCase().replace(/[\s\-–—.]+/g, '');
      if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) {
        visStartFeil('Oppgi gyldig understellsnummer med 11–17 tegn uten I, O eller Q.');
        return;
      }
      var btn = this.querySelector('button[type="submit"]');
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Søker etter bilen…';
      fetch('/api/vin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin: vin, lookupOnly: true })
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.bil && d.bil.merke) {
            state.regnr = '';
            settBilFraSvv(d.bil, null, '');
          } else {
            visStartFeil('Vi fant ikke bilen via VIN. Send merke, modell og årsmodell til oss på e-post.');
          }
        })
        .catch(function () { visStartFeil('VIN-oppslag feilet. Prøv igjen eller kontakt oss.'); })
        .finally(function () { btn.disabled = false; btn.textContent = original; });
    });

  // P1.1B: manuell henvendelse uten skilt og VIN.
  $('btn-manual').addEventListener('click', function () {
    var form = $('form-manual');
    var expanded = form.classList.contains('hidden');
    form.classList.toggle('hidden', !expanded);
    this.setAttribute('aria-expanded', String(expanded));
    if (expanded) $('manual-make').focus();
  });
  $('btn-uten-skilt').addEventListener('click', function () {
    if ($('form-vin').classList.contains('hidden')) {
      $('form-manual').classList.add('hidden');
      $('btn-manual').setAttribute('aria-expanded', 'false');
    }
  });

  $('form-manual').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this;
    if (form.dataset.sent === 'true') return;
    function value(id) { return $(id).value.trim().replace(/\s+/g, ' '); }
    var make = value('manual-make');
    var model = value('manual-model');
    var year = value('manual-year');
    var name = value('manual-name');
    var contact = value('manual-contact');
    var notes = value('manual-notes');
    var feedback = $('manual-result');
    feedback.classList.remove('hidden');
    function show(message) { feedback.textContent = message; }
    if (make.length < 2 || make.length > 50 || !model || model.length > 80) {
      show('Oppgi bilmerke og modell.'); return;
    }
    var maxYear = new Date().getFullYear() + 1;
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > maxYear) {
      show('Oppgi en gyldig anslått årsmodell.'); return;
    }
    if (name.length < 2 || name.length > 80) {
      show('Oppgi navn med minst to tegn.'); return;
    }
    var digits = contact.replace(/\D/g, '');
    if (contact.length > 120 ||
        (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && digits.length < 8)) {
      show('Oppgi et gyldig telefonnummer eller en e-postadresse.'); return;
    }
    var message = 'Uten skilt/VIN – frontrute. Bilmerke: ' + make +
      '; modell: ' + model + '; anslått årsmodell: ' + year +
      (notes ? '; detaljer: ' + notes : '');
    if (message.length > 500) {
      show('Beskrivelsen er for lang. Forkort tilleggsopplysningene.'); return;
    }
    var button = form.querySelector('button[type="submit"]');
    var label = button.textContent;
    button.disabled = true;
    button.textContent = 'Sender forespørsel…';
    show('Sender forespørsel…');
    fetch('/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        regnr: '', navn: name, kontakt: contact, melding: message, sessionId: sessionId
      })
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (r) {
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || 'Kunne ikke sende forespørselen.');
        show('Takk! Vi har mottatt forespørselen' +
          (r.data.inquiryId != null ? ' (saksnummer ' + r.data.inquiryId + ')' : '') +
          '. Vi kontrollerer bil og glass manuelt før tilbud. Ingen bestilling er gjennomført.');
        form.dataset.sent = 'true';
        form.querySelectorAll('input, textarea').forEach(function (field) { field.disabled = true; });
      })
      .catch(function (e) { show(e.message || 'Kunne ikke sende forespørselen. Prøv igjen.'); })
      .finally(function () { button.disabled = form.dataset.sent === 'true'; button.textContent = label; });
  });

  // 1b. Foto av skiltnummeret → AI leser skiltet → SVV-oppslag (samme flyt som skrevet regnr).
  // Oppgave 7: klientside bildebehandling — EXIF-orientering, nedskalering, JPEG-komprimering,
  // thumbnail og kvalitetssjekk (lysstyrke/størrelse) FØR opplasting. HEIC konverteres til
  // JPEG av nettleseren (iOS Safari dekoder HEIC → canvas → JPEG) — Workers har ingen HEIC-dekoder.
  var MAX_BREDDE = 1920, THUMB_BREDDE = 320, KVALITET = 0.8;
  var LUMINANS_MIN = 55, MIN_BREDDE = 400, GLARE_HIGH = 240, GLARE_ANDEL = 0.25;

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
            var sum = 0, lyse = 0, n = imgd.length / 4;
            for (var i = 0; i < imgd.length; i += 4) {
              var l = 0.2126 * imgd[i] + 0.7152 * imgd[i + 1] + 0.0722 * imgd[i + 2];
              sum += l;
              if (l > GLARE_HIGH) lyse++;
            }
            if (sum / n < LUMINANS_MIN) advarsler.push('bildet er mørkt');
            if (lyse / n > GLARE_ANDEL) advarsler.push('mye gjenskinn eller reflekser');
          } catch (e) { /* piksel-lesing utilgjengelig — hopp over lys-/gjenskinn-sjekk */ }
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
    state.currentGlassKind = null;
    state.glassRequest = null;
    state.clientRequestId = null;
    state.inquiryAttempted = false;
    state.preferredWindshieldCandidate = null;
    $('glass-placement').classList.add('hidden');
    $('inquiry-glass-summary').classList.add('hidden');
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
    // → trygg manuell kontroll («Vi vil dobbeltsjekke riktig glass …»).
    settSpm(resolver && Array.isArray(resolver.sporsmaal) ? resolver.sporsmaal : []);
    $('glass-merkelbl').textContent = '';
    visMerkeLogo(state.merke);
    $('glass-bilnavn').textContent = penSkrivemaate(state.modell) + (state.aar ? ' · ' + state.aar : '');
    renderGlassDet();
    visRegnr();
    var ev4 = document.querySelector('.evidence-gruppe[data-key="interior_optional"]');
    if (ev4) ev4.classList.toggle('hidden', !glassKanHaSensorKamera());
    var ev = document.querySelector('.evidence-capture');
    if (ev) ev.classList.add('hidden');
    show('glass');
  }

  // Evidence Capture: supportdokumentasjon, separat fra beslutningsmotoren.
  // Ingen respons herfra brukes i resolveren eller kan sette EXACT.
  // Modernisert (Oppgave 7): klientside komprimering + EXIF-orientering +
  // thumbnail + kvalitetssjekk (lysstyrke/størrelse) FØR opplasting.
  // ── P0.2: mobil-først fotoopplevelse (kamera primær, bildebibliotek sekundær) ──
  var evidenceBilder = {}; // key → { dataUrl, thumbDataUrl, advarsler }

  function evidenceNokkel(el) { return el.getAttribute('data-key'); }

  // Primær: kamera (capture=environment på skjult input); sekundær: bibliotek (uten capture).
  document.querySelectorAll('.evidence-kamera').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var inp = document.getElementById('evidence-' + evidenceNokkel(btn));
      if (inp) inp.click();
    });
  });
  document.querySelectorAll('.evidence-bibliotek').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var inp = document.getElementById('evidence-' + evidenceNokkel(btn) + '-bib');
      if (inp) inp.click();
    });
  });

  function evidenceFeil(msg) {
    var r = $('evidence-result');
    r.textContent = msg;
    r.classList.remove('hidden', 'ok');
  }

  // «Send bilder» er kun aktiv når minst ett bilde er valgt — bildene er valgfrie,
  // og glassvalg er veien videre. Deaktivert uten bilder forhindrer «stuck»-felle på PC/pad/mac.
  function oppdaterEvidenceKnapp() {
    var b = document.getElementById('btn-evidence-submit');
    if (b) b.disabled = !Object.keys(evidenceBilder).length;
  }

  function visEvidenceMiniatyr(key, res) {
    var mini = document.querySelector('.evidence-miniatyr[data-key="' + key + '"]');
    if (!mini) return;
    mini.classList.remove('hidden');
    var img = mini.querySelector('.evidence-thumb');
    if (img) img.src = res.thumbDataUrl || res.dataUrl;
  }

  function fjernEvidence(key) {
    delete evidenceBilder[key];
    var mini = document.querySelector('.evidence-miniatyr[data-key="' + key + '"]');
    if (mini) mini.classList.add('hidden');
    var r = $('evidence-result');
    if (r && !Object.keys(evidenceBilder).length) r.classList.add('hidden');
    oppdaterEvidenceKnapp();
  }

  function handterEvidenceFil(key, input) {
    var f = input.files && input.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { evidenceFeil('Filen må være et bilde.'); return; }
    if (f.size > 20 * 1024 * 1024) { evidenceFeil('Bildet er over 20 MB.'); return; }
    komprimerBilde(f).then(function (res) {
      evidenceBilder[key] = res;
      visEvidenceMiniatyr(key, res);
      oppdaterEvidenceKnapp();
    }).catch(function () {
      evidenceFeil('Kunne ikke lese bildet. Prøv igjen.');
    });
  }

  ['plate', 'windshield', 'mirror_sensor', 'interior_optional'].forEach(function (key) {
    var kamera = document.getElementById('evidence-' + key);
    var bib = document.getElementById('evidence-' + key + '-bib');
    if (kamera) kamera.addEventListener('change', function () { handterEvidenceFil(key, kamera); kamera.value = ''; });
    if (bib) bib.addEventListener('change', function () { handterEvidenceFil(key, bib); bib.value = ''; });
  });

  document.querySelectorAll('.evidence-ta-paa-nytt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var inp = document.getElementById('evidence-' + evidenceNokkel(btn));
      if (inp) inp.click();
    });
  });
  document.querySelectorAll('.evidence-fjern').forEach(function (btn) {
    btn.addEventListener('click', function () { fjernEvidence(evidenceNokkel(btn)); });
  });

  // Send — beholder komprimering/EXIF/kvalitetssjekk/R2 + token-/feature-gates.
  $('btn-evidence-submit').addEventListener('click', function () {
    var keys = Object.keys(evidenceBilder);
    var resultat = $('evidence-result');
    var settFeil = function (msg) { resultat.textContent = msg; resultat.classList.remove('hidden', 'ok'); };
    var settOk = function (msg) { resultat.textContent = msg; resultat.classList.remove('hidden'); resultat.classList.add('ok'); };
    if (!keys.length) { settFeil('Ta minst ett bilde først.'); return; }
    if (!state.regnr) { settFeil('Søk opp bilen først — vi trenger skiltnummeret for å knytte bildene til en sak.'); return; }
    var knapp = this;
    knapp.disabled = true;
    knapp.textContent = 'Sender bilder…';
    var advarsler = keys.filter(function (k) { return evidenceBilder[k].advarsler && evidenceBilder[k].advarsler.length; });
    if (advarsler.length) {
      if (!window.confirm('Bildekvaliteten er dårlig for ' + advarsler.length + ' bilde(r) (' + evidenceBilder[advarsler[0]].advarsler.join(', ') + '). Vil du likevel sende?')) {
        knapp.disabled = false; knapp.textContent = 'Send bilder til Tom Arne'; return;
      }
    }
    var bilder = keys.map(function (key) {
      return { type: key, data: evidenceBilder[key].dataUrl, thumbnail: evidenceBilder[key].thumbDataUrl };
    });
    fetch('/api/evidence-capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regnr: state.regnr, sessionId: sessionId, images: bilder })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok || !r.data.ok) throw new Error(r.data.error || 'Bildene ble ikke sendt.');
        state.evidenceSent = true;
        $('btn-inquiry').disabled = false;
        settOk('Takk – vi har fått bildene og dobbeltsjekker glasset før vi sender tilbud.');
        loggHendelse('evidence_capture_sent', { caseId: r.data.caseId, imageCount: r.data.imageCount });
        keys.forEach(fjernEvidence);
      })
      .catch(function () {
        // Menneskelig feilmelding; teknisk årsak logges internt, aldri til kunde.
        settFeil('Bildene ble ikke sendt. Prøv igjen, eller send oss en forespørsel så hjelper vi deg.');
      })
      .finally(function () { knapp.disabled = false; knapp.textContent = 'Send bilder til Finnbilglass'; });
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
  //    skiltnummer (SVV) er eneste inngang; «Annet» → kontakt; «Tilbake»/«Nytt søk» → start.


  function glassSideLabel(value) { return value === 'left' ? 'Venstre' : value === 'right' ? 'Høyre' : 'Vet ikke hvilken side'; }
  function glassSelectionLabel(selection) {
    if (!selection) return '';
    if (selection.kind === 'windshield') return 'Frontrute';
    if (selection.kind === 'door') return 'Dørrute · ' + glassSideLabel(selection.side) + ' · ' + ({front:'Foran',rear:'Bak',sliding:'Skyvedør',unknown:'Vet ikke hvilken dør'}[selection.door]);
    if (selection.kind === 'side') return 'Siderute · ' + glassSideLabel(selection.side) + ' · ' + ({front_quarter:'Fremre trekantrute',rear_quarter:'Bakre trekantrute',cargo:'Lasterom',unknown:'Vet ikke plassering'}[selection.section]) + ' · ' + ({body:'Karosseri',door:'Dør',unknown:'Vet ikke'}[selection.mounting]);
    if (selection.kind === 'rear') return 'Bakrute · ' + (selection.layout === 'single' ? 'Hel rute' : selection.layout === 'split' ? 'Delt rute · ' + glassSideLabel(selection.splitSide) : 'Vet ikke om ruten er delt');
    if (selection.kind === 'roof') return 'Panoramatak / takglass · ' + ({fixed:'Fast',opening:'Åpningsbart',unknown:'Vet ikke'}[selection.system]) + ' · ' + ({whole:'Hele ruten',front:'Fremre panel',middle:'Midtre panel',rear:'Bakre panel',unknown:'Vet ikke panel'}[selection.panel]);
    return 'Ukjent glasstype';
  }

  var GLASS_FIELDS = {
    door: [
      ['side','Hvilken side?',[['left','Venstre'],['right','Høyre'],['unknown','Vet ikke']]],
      ['door','Hvilken dør?',[['front','Foran'],['rear','Bak'],['sliding','Skyvedør'],['unknown','Vet ikke']]]
    ],
    side: [
      ['side','Hvilken side?',[['left','Venstre'],['right','Høyre'],['unknown','Vet ikke']]],
      ['section','Hvor sitter sideruten?',[['front_quarter','Fremre trekantrute'],['rear_quarter','Bakre trekantrute'],['cargo','Lasterom'],['unknown','Vet ikke']]],
      ['mounting','Hvor er ruten festet?',[['body','Karosseri'],['door','Dør'],['unknown','Vet ikke']]]
    ],
    rear: [['layout','Er bakruten hel eller delt?',[['single','Hel'],['split','Delt'],['unknown','Vet ikke']]]],
    roof: [
      ['system','Er takglasset fast eller åpningsbart?',[['fixed','Fast'],['opening','Åpningsbart'],['unknown','Vet ikke']]],
      ['panel','Hvilket panel gjelder det?',[['whole','Hele ruten'],['front','Fremre panel'],['middle','Midtre panel'],['rear','Bakre panel'],['unknown','Vet ikke']]]
    ]
  };

  function renderGlassFields(kind) {
    var fields = $('glass-placement-fields');
    fields.textContent = '';
    (GLASS_FIELDS[kind] || []).forEach(function (definition) {
      var label = document.createElement('label');
      label.className = 'felt glass-position-field';
      var title = document.createElement('span');
      title.textContent = definition[1];
      var select = document.createElement('select');
      select.name = definition[0];
      select.setAttribute('aria-label', definition[1]);
      var initial = document.createElement('option');
      initial.value = '';
      initial.textContent = 'Velg et alternativ';
      select.appendChild(initial);
      definition[2].forEach(function (option) {
        var item = document.createElement('option');
        item.value = option[0];
        item.textContent = option[1];
        select.appendChild(item);
      });
      label.appendChild(title);
      label.appendChild(select);
      fields.appendChild(label);
    });
    if (kind === 'rear') {
      var splitLabel = document.createElement('label');
      splitLabel.className = 'felt glass-position-field hidden';
      splitLabel.id = 'glass-split-side-field';
      var splitTitle = document.createElement('span');
      splitTitle.textContent = 'Hvilken del er skadet?';
      var split = document.createElement('select');
      split.name = 'splitSide';
      split.setAttribute('aria-label', splitTitle.textContent);
      [['','Velg et alternativ'],['left','Venstre'],['right','Høyre'],['unknown','Vet ikke']].forEach(function (option) {
        var item = document.createElement('option'); item.value = option[0]; item.textContent = option[1]; split.appendChild(item);
      });
      splitLabel.appendChild(splitTitle); splitLabel.appendChild(split); fields.appendChild(splitLabel);
      fields.querySelector('[name="layout"]').addEventListener('change', function () {
        splitLabel.classList.toggle('hidden', this.value !== 'split');
        split.value = '';
      });
    }
  }

  function selectionFromFields(kind) {
    var fields = $('glass-placement-fields');
    var value = function (key) { var el = fields.querySelector('[name="' + key + '"]'); return el ? el.value : ''; };
    var selection;
    if (kind === 'door') selection = { kind: kind, side: value('side'), door: value('door') };
    if (kind === 'side') selection = { kind: kind, side: value('side'), section: value('section'), mounting: value('mounting') };
    if (kind === 'rear') {
      var layout = value('layout');
      selection = { kind: kind, layout: layout };
      if (layout === 'split') selection.splitSide = value('splitSide');
    }
    if (kind === 'roof') selection = { kind: kind, system: value('system'), panel: value('panel') };
    var missing = Object.keys(selection || {}).filter(function (key) { return key !== 'kind' && !selection[key]; });
    if (missing.length) {
      $('glass-placement-error').textContent = 'Velg et svar for hvert felt, eller velg «Vet ikke».';
      $('glass-placement-error').classList.remove('hidden');
      var first = fields.querySelector('[name="' + missing[0] + '"]'); if (first) first.focus();
      return null;
    }
    $('glass-placement-error').classList.add('hidden');
    return selection;
  }

  function visGlassResultat(request, data, generation) {
    if (generation !== searchGeneration) return;
    var candidates = Array.isArray(data.candidates) ? data.candidates : [];
    var status = data.status;
    if (status === 'CANDIDATES' && !candidates.length) status = 'MANUAL_REVIEW';
    request.searchId = typeof data.searchId === 'string' ? data.searchId : undefined;
    state.glassRequest = request;
    state.clientRequestId = null;
    $('glass-placement').classList.add('hidden');
    $('screen-resultat').querySelector('h2').textContent = status === 'NEEDS_DETAILS' ? 'Vi trenger én opplysning til' : status === 'CANDIDATES' ? 'Mulige glass til bilen' : 'Vi kontrollerer ruten manuelt';
    $('resultat-regnr').textContent = state.regnr ? 'Kjennemerke: ' + state.regnr : '';
    $('resultat-regnr').classList.toggle('hidden', !state.regnr);
    $('resultat-kort').textContent = glassSelectionLabel(request.selection);
    $('tilbehor-seksjon').classList.add('hidden');
    $('resultat-alt').textContent = '';
    state.preferredWindshieldCandidate = null;
    state.evidenceSent = false;
    var info = $('resultat-status');
    info.textContent = data.message || 'Vi kontrollerer ruten og riktig glass før vi sender tilbud.';
    info.className = 'note status ' + (status === 'CANDIDATES' ? 'verify' : '');
    info.classList.remove('hidden');
    if (candidates.length) {
      candidates.forEach(function (candidate, index) {
        var item = document.createElement('label');
        item.className = 'alt-row variant-choice';
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'preferred-windshield-variant';
        radio.value = candidate.candidateId || candidate.partNumber || '';
        radio.setAttribute('aria-label', 'Mulig frontrutevariant ' + (candidate.partNumber || index + 1));
        radio.addEventListener('change', function () {
          state.preferredWindshieldCandidate = { partNumber: candidate.partNumber || candidate.candidateId || '', description: candidate.manufacturer || '' };
          $('inquiry-glass-summary').textContent = glassSelectionLabel(request.selection) + ' · valgt variant kontrolleres manuelt';
        });
        item.appendChild(radio);
        var label = document.createElement('span');
        label.textContent = 'Mulig treff · ' + (candidate.manufacturer ? candidate.manufacturer + ' · ' : '') + candidate.partNumber;
        item.appendChild(label);
        $('resultat-alt').appendChild(item);
      });
      if (data.truncated) {
        var more = document.createElement('p'); more.className = 'note'; more.textContent = 'Flere mulige treff finnes. Vi kontrollerer riktig variant.'; $('resultat-alt').appendChild(more);
      }
    }
    $('inquiry-regnr').value = state.regnr || '';
    $('inquiry-glass-summary').textContent = glassSelectionLabel(request.selection);
    $('inquiry-glass-summary').classList.remove('hidden');
    $('inquiry-form').classList.add('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('btn-inquiry').disabled = false;
    show('resultat');
  }

  function sokGlass(selection) {
    var request = { schemaVersion: 1, selection: selection, answers: {} };
    var generation = ++searchGeneration;
    state.glassRequest = request;
    state.preferredWindshieldCandidate = null;
    state.clientRequestId = null;
    $('resultat-kort').textContent = '';
    $('resultat-alt').textContent = '';
    $('inquiry-bekreftet').classList.add('hidden');
    $('inquiry-form').classList.add('hidden');
    $('inquiry-glass-summary').textContent = glassSelectionLabel(selection);
    $('inquiry-glass-summary').classList.remove('hidden');
    $('btn-inquiry').disabled = true;
    $('resultat-status').textContent = 'Vi undersøker ruten og kataloggrunnlaget…';
    $('resultat-status').className = 'note status';
    $('resultat-status').classList.remove('hidden');
    show('resultat');
    fetch('/api/glass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regnr: state.regnr, glassRequest: request }) })
      .then(function (r) { return r.json().then(function (data) { if (!r.ok) throw new Error(data.error || 'Søket feilet'); return data; }); })
      .then(function (data) { visGlassResultat(request, data, generation); })
      .catch(function (error) {
        if (generation !== searchGeneration) return;
        visGlassResultat(request, { status: 'MANUAL_REVIEW', candidates: [], message: error.message || 'Søket er midlertidig utilgjengelig. Du kan sende en manuell forespørsel.' }, generation);
      });
  }

  // 4. Glasstype. Frontruten beholder den eksisterende, dokumenterte flyten.
  document.querySelectorAll('.glassopt[data-type]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      var kind = b.dataset.type;
      if (kind !== 'front') return; // Other glass categories are paused.
      document.querySelectorAll('.glassopt[data-type]').forEach(function (button) { button.classList.toggle('aktiv', button === b); button.setAttribute('aria-pressed', button === b ? 'true' : 'false'); });
      $('glass-placement-error').classList.add('hidden');
      $('resultat-kort').textContent = '';
      $('resultat-alt').textContent = '';
      $('btn-inquiry').disabled = true;
      $('inquiry-form').classList.add('hidden');
      $('inquiry-bekreftet').classList.add('hidden');
      state.glassRequest = null;
      state.clientRequestId = null;
      if (kind === 'front') {
        state.currentGlassKind = 'windshield';
        $('glass-placement').classList.add('hidden');
        $('inquiry-glass-summary').classList.add('hidden');
        loggHendelse('velg_frontrute', { merke: state.merke, modell: state.modell, regnr: state.regnr });
        spmIndex = 0;
        if (spm.length) { spmRender(); show('spm'); return; }
        // The initial vehicle lookup is intentionally cheap and does not run
        // the resolver. Load candidates only when the customer chooses windscreen.
        $('resultat-status').textContent = 'Vi undersøker glassvariantene…';
        $('resultat-status').className = 'note status';
        $('resultat-status').classList.remove('hidden');
        show('resultat');
        fetch('/api/frontrute', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merke: state.merke, modell: state.modell, aar: state.aar, vin: state.vin, profil: {} }) })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            // A single catalogue candidate is still an unconfirmed fitment.
            state.resolver = { utfall: 'VERIFY', kandidater: data.kandidater || [], sporsmaal: data.sporsmaal || [] };
            settSpm(state.resolver.sporsmaal);
            if (spm.length) { spmIndex = 0; spmRender(); show('spm'); return; }
            renderResultat(data);
          })
          .catch(function () { tomtVis('Vi kontrollerer frontruten manuelt', 'Vi fikk ikke hentet kandidatene akkurat nå. Send en forespørsel, så kontrollerer vi glasset manuelt.'); });
        return;
      }
      state.currentGlassKind = kind;
      if (kind === 'unknown') { $('glass-placement').classList.add('hidden'); sokGlass({ kind: 'unknown' }); return; }
      $('glass-placement-title').textContent = kind === 'door' ? 'Hvilken dørrute?' : kind === 'side' ? 'Hvilken siderute?' : kind === 'rear' ? 'Hvilken bakrute?' : 'Hvilket takglass?';
      renderGlassFields(kind);
      $('glass-placement').classList.remove('hidden');
      $('glass-placement-title').focus();
    });
  });



  // 5. Utstyrs-spørsmål — KUN funksjoner som faktisk skiller kandidatene stilles.
  //    Aldri spør om noe som ikke finnes som variant for bilen (Tom-doktrine).
  var SPM_DEF = {
    sensor:    { tittel: 'Har bilen regnsensor?', hjelp: 'Da starter viskerne automatisk når det regner.' },
    antenne:   { tittel: 'Har bilen radioantenne i frontruten?', hjelp: 'Usikker? Velg «Vet ikke». Vi dobbeltsjekker før sending.' },
    hud:       { tittel: 'Har bilen head-up display?', hjelp: 'Informasjon projiseres på frontruten foran sjåføren.' },
    ldw:       { tittel: 'Har bilen feltskiftevarsling (LDW)?', hjelp: 'Bilen varsler hvis den er i ferd med å krysse en kjørefeltlinje. Velg «Vet ikke» hvis du er usikker.' },
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

  // Bilde 4 («under speil innenfra») vises kun når glasset kan ha sensor/kamera-utstyr
  // (kamera-feste bak speil eller regn-/lyssensor). Ukjent → konservativt vis.
  function glassKanHaSensorKamera() {
    var k = state.resolver && state.resolver.kandidater;
    if (!k || !k.length) return false;
    return k.some(function (kand) {
      var a = kand && kand.attributter;
      if (!a) return true;
      return a.cameraBracket !== false || a.rainLightSensor !== false;
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
    if (key === 'sensor' || key === 'antenne' || key === 'coated' || key === 'hud' || key === 'ldw' || key === 'kamera' || key === 'adas' || key === 'oppvarmet') state.profil[key] = val === undefined ? 'unknown' : val;
    else state.info[key] = val === undefined ? 'unknown' : val; // Unknown is explicit and does not remove candidates.
    if (spmIndex < spm.length - 1) { spmIndex++; spmRender(); return; }
    gaaTilResultat();
  }

  // Velg direkte blant resolver-kandidatene når de finnes; ellers /api/frontrute.
  function gaaTilResultat() {
    searchGeneration++;
    var valgt = filtrerResolverKandidater();
    if (valgt && renderResolverResultat(valgt)) return;
    // A new vehicle must never show the previous vehicle's glass while loading.
    $('resultat-kort').textContent = '';
    $('resultat-alt').textContent = '';
    $('tilbehor-seksjon').classList.add('hidden');
    $('btn-inquiry').disabled = true;
    var loading = $('resultat-status');
    loading.textContent = 'Vi undersøker glassvariantene…';
    loading.className = 'note status';
    show('resultat');
    lastResultat();
  }

  // Filtrer resolver-kandidater på kundens svar (kun besvarte funksjoner;
  // kandidat med ukjent verdi for funksjonen strykes ikke — vi vet ikke).
  function filtrerResolverKandidater() {
    var r = state.resolver;
    if (!r || !r.kandidater || !r.kandidater.length) return null;
    var svar = {};
    ['sensor', 'antenne', 'coated', 'hud', 'ldw', 'kamera', 'adas', 'oppvarmet'].forEach(function (k) {
      if (state.profil[k] === true || state.profil[k] === false) svar[k] = state.profil[k];
    });
    ['hud', 'ldw', 'kamera', 'adas', 'oppvarmet'].forEach(function (k) {
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
  // Kandidater kan veilede glassvalget, men kundepris gis bare i godkjent tilbud.
  function renderResolverResultat(kandidater) {
    if (!kandidater || !kandidater.length) return false;
    var en = kandidater.length === 1 ? kandidater[0] : null;
    var valg = en || kandidater[0];
    renderResultat({
      pinpoint: false,
      anbefaling: {
        candidateId: valg.candidateId,
        varenavn: valg.varenavn || null,
        kundeprisInklMva: valg.kundeprisInklMva
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
    var requestGeneration = searchGeneration;
    var body = { merke: state.merke, modell: state.modell, aar: state.aar, vin: state.vin, profil: state.profil };
    fetch('/api/frontrute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (requestGeneration !== searchGeneration) return;
        renderResultat(data);
      })
      .catch(function () {
        if (requestGeneration !== searchGeneration) return;
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
    if (a.ldw) deler.push('med feltskiftevarsling');
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

  function renderResultat(data) {
    visRegnr();
    $('btn-inquiry').disabled = false;
    // P0.1: tilbehørsseksjonen vises ikke generisk — kun per kandidat/glass (nedenfor).
    // Forhåndsutfyll henvendelsesskjema med skiltnummeret (låst) — beta-tilbudsflyt.
    $('inquiry-regnr').value = state.regnr || '';
    var a = data && data.anbefaling;
    if (!a) {
      tomtVis('Vi kontrollerer frontruten manuelt', 'Vi fant ingen sikker variant ut fra svarene dine. Send en forespørsel, så kontrollerer vi riktig glass og gir deg et tilbud.');
      return;
    }
    var antallKandidater = Array.isArray(data.kandidater) ? data.kandidater.length : 0;
    $('screen-resultat').querySelector('h2').textContent = antallKandidater > 1 ? 'Mulige frontrutevarianter' : 'Mulig frontrute';
    var st = $('resultat-status');
    if (data.pinpoint) {
      st.textContent = 'Dette er vårt beste forslag basert på bilen din. Vi dobbeltsjekker glasset manuelt og bekrefter riktig glass og pris før noe bestilles.';
      st.className = 'note status pinpoint';
    } else if (data && data.meta && data.meta.resolver) {
      st.textContent = antallKandidater > 1
        ? 'Flere varianter kan passe bilen. Velg gjerne det du tror bilen har; vi bekrefter alltid riktig glass manuelt før tilbud.'
        : 'Dette glasset kan passe bilen. Vi bekrefter alltid riktig glass manuelt før tilbud.';
      st.className = 'note status verify';
    } else {
      st.textContent = 'Vi har funnet en mulig kandidat ut fra bildataene dine. Vi dobbeltsjekker valget manuelt før vi sender tilbud.';
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
    kort.querySelector('.meta').textContent = a.kundeprisInklMva != null && antallKandidater <= 1
      ? 'Glasspris ' + Number(a.kundeprisInklMva).toLocaleString('nb-NO') + ' kr inkl. mva.'
      : antallKandidater > 1 ? antallKandidater + ' mulige varianter · priser vises der katalogen har bekreftet pris inkl. mva.' : 'Riktig glass og pris bekreftes før tilbud.';

    var specs = [];
    if (state.profil.sensor === true) specs.push('med regnsensor');
    if (state.profil.sensor === false) specs.push('uten regnsensor');
    if (state.profil.antenne === true) specs.push('med antenne i glasset');
    if (state.profil.coated === true) specs.push('med sol-/varmedempende belegg');
    if (state.profil.coated === false) specs.push('uten sol-/varmedempende belegg');
    if (state.info.kamera === true) specs.push('med kamera bak speilet');
    if (state.info.ldw === true) specs.push('med feltskiftevarsling');
    if (state.info.hud === true) specs.push('med head-up-display');
    if (state.info.oppvarmet === true) specs.push('oppvarmet');
    kort.querySelector('.spec').textContent = specs.join(' · ');

    var alt = $('resultat-alt');
    alt.innerHTML = '';
    state.preferredWindshieldCandidate = null;
    if (data.kandidater && data.kandidater.length > 0 && !data.pinpoint) {
      var intro = document.createElement('p');
      intro.className = 'varianter-intro';
      intro.textContent = data.kandidater.length > 1
        ? 'Disse frontrutene kan passe bilen. Svarene dine snevrer inn alternativene. Pris vises inkl. mva. når den er dokumentert. Vi kontrollerer valgt glass før tilbud.'
        : 'Dette er en mulig frontrute. Vi kontrollerer glasset før tilbud.';
      alt.appendChild(intro);
      data.kandidater.forEach(function (k, index) {
        var row = document.createElement('label');
        row.className = 'alt-row variant-choice';
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'preferred-windshield-variant';
        radio.value = k.candidateId || '';
        radio.setAttribute('aria-label', 'Mulig frontrutevariant ' + (index + 1));
        radio.addEventListener('change', function () {
          state.preferredWindshieldCandidate = { partNumber: k.candidateId || '', description: beskrivVariant(k) || k.varenavn || '' };
          $('inquiry-glass-summary').textContent = 'Frontrute · ønsket variant: ' + (state.preferredWindshieldCandidate.description || 'valgt variant') + ' · kontrolleres manuelt';
        });
        row.appendChild(radio);
        var beskrivelse = beskrivVariant(k);
        var txt = document.createElement('span');
        txt.className = 'alt-beskrivelse';
        var prisTekst = typeof k.kundeprisInklMva === 'number' && Number.isFinite(k.kundeprisInklMva) && k.kundeprisInklMva > 0
          ? ' · Glasspris ' + Number(k.kundeprisInklMva).toLocaleString('nb-NO') + ' kr inkl. mva.'
          : ' · Pris oppgis i tilbudet';
        txt.textContent = 'Mulig variant' + (beskrivelse ? ' — ' + beskrivelse : k.varenavn ? ' — ' + k.varenavn : '') + prisTekst;
        row.appendChild(txt);
        alt.appendChild(row);
      });
      var evidence = document.querySelector('.evidence-capture');
      if (evidence) {
        var resultatScreen = document.getElementById('screen-resultat');
        var resultatAlt = document.getElementById('resultat-alt');
        if (resultatScreen && resultatAlt && evidence.previousElementSibling !== resultatAlt) {
          resultatAlt.after(evidence);
        }
        evidence.classList.remove('hidden');
        var evidenceTitle = $('evidence-title');
        var evidenceIntro = $('evidence-intro');
        if (evidenceTitle) evidenceTitle.textContent = 'Send ett eller to bilder';
        if (evidenceIntro) evidenceIntro.textContent = 'Ett bilde er nok for å sende forespørselen. To bilder gir best grunnlag: ett av hele frontruten og ett av området ved speilet/sensoren. Det hjelper oss å kontrollere riktig glass før vi sender tilbud. Bildene endrer aldri glassvalget automatisk.';
      }
    $('btn-inquiry').textContent = 'Be om uforpliktende tilbud';
    $('btn-inquiry').disabled = false;
    }

    // P0.1 (Tom-doktrine): tilbehør er kandidat- og glassstyrt via
    // /api/accessories (AccessoryApplicabilityEngine som fasit).
    var tilbehorSeksjon = $('tilbehor-seksjon');
    var verifyTekst = $('tilbehor-verify');
    var montasjeValg = $('montasje-valg');
    if (data.pinpoint && a && a.candidateId) {
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
    if (state === 'REQUIRED_SEPARATE') return 'Dette er nødvendig tilbehør for denne glassvarianten.';
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
      body: JSON.stringify({ varenr: kandidat.candidateId || null, features: features, fitmentStatus: fitmentStatus })
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
    // KUN tilgjengelig ved file:// (offline demo); ingen kundevendt pris.
    return {
      demoData: true,
      anbefaling: { varenr: '8579AGSGYAVZ1B', eurokode: '8579AGSGYAVZ1B' },
      kandidater: [
        { varenr: '8579AGSGYAVZ1B' },
        { varenr: '8579ACSGYAVZ1B' }
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
    if (state.glassRequest) {
      $('inquiry-glass-summary').textContent = glassSelectionLabel(state.glassRequest.selection);
      $('inquiry-glass-summary').classList.remove('hidden');
    } else {
      $('inquiry-glass-summary').classList.add('hidden');
    }
    $('inquiry-navn').focus();
  });

  $('btn-tomt-inquiry').addEventListener('click', function () {
    $('inquiry-regnr').value = state.regnr || '';
    $('inquiry-feil').classList.add('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('resultat-kort').textContent = 'Vi fant ikke et bekreftet glass. Vi undersøker forespørselen manuelt.';
    $('resultat-alt').textContent = '';
    $('resultat-status').classList.add('hidden');
    $('inquiry-form').classList.remove('hidden');
    show('resultat');
    $('inquiry-navn').focus();
  });

  function inquiryFeil(msg) {
    var el = $('inquiry-feil');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function visManuellEtterUtloepsvarsel() {
    var el = $('inquiry-feil');
    if (!el || !state.glassRequest) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'link';
    button.textContent = 'Send som manuell forespørsel uten søkereferanse';
    button.addEventListener('click', function () {
      var request = state.glassRequest;
      if (!request) return;
      var selection = request.selection;
      var answers = request.answers || {};
      state.glassRequest = { schemaVersion: 1, selection: selection, answers: answers };
      state.clientRequestId = nyClientRequestId();
      state.inquiryAttempted = false;
      button.remove();
      inquiryFeil('Søket er fjernet fra innsendingen. Vi beholder valgt glasstype og kontrollerer forespørselen manuelt.');
    });
    el.appendChild(document.createTextNode(' '));
    el.appendChild(button);
  }

  // Enkel regex: ser ut som telefon (minst 8 siffer) ELLER e-post (inneholder @ og .).
  function gyldigKontakt(s) {
    var v = (s || '').trim();
    if (!v) return false;
    var sifre = v.replace(/[^0-9]/g, '');
    if (sifre.length >= 8) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function gyldigTelefon(s) { return /^(?:\+47|0047)?\d{8}$/.test((s || '').replace(/[\s-]/g, '')); }
  function gyldigEpost(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim()); }
  function oppdaterKontaktfelt() {
    var valg = $('inquiry-kontaktpreferanse').value;
    var hoved = $('inquiry-kontakt');
    var ekstra = $('inquiry-telefon-ekstra');
    if (valg === 'begge' && gyldigTelefon(hoved.value) && !ekstra.value) { ekstra.value = hoved.value; hoved.value = ''; }
    if (valg === 'telefon' && gyldigEpost(hoved.value) && gyldigTelefon(ekstra.value)) hoved.value = ekstra.value;
    $('inquiry-telefon-ekstra-felt').classList.toggle('hidden', valg !== 'begge');
    $('inquiry-kontakt-label').textContent = valg === 'telefon' ? 'Telefonnummer' : 'E-postadresse';
    hoved.type = valg === 'telefon' ? 'tel' : 'email';
    hoved.autocomplete = valg === 'telefon' ? 'tel' : 'email';
    hoved.inputMode = valg === 'telefon' ? 'tel' : 'email';
    hoved.placeholder = valg === 'telefon' ? 'F.eks. 40 40 82 41' : 'F.eks. navn@epost.no';
  }
  $('inquiry-kontaktpreferanse').addEventListener('change', oppdaterKontaktfelt);

  function nyClientRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 18);
  }

  ['inquiry-navn', 'inquiry-kontakt', 'inquiry-telefon-ekstra', 'inquiry-melding', 'inquiry-kontaktpreferanse'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (state.glassRequest && state.inquiryAttempted) {
        state.clientRequestId = nyClientRequestId();
        state.inquiryAttempted = false;
      }
    });
  });

  $('btn-inquiry-send').addEventListener('click', function () {
    var regnr = $('inquiry-regnr').value.trim();
    var navn = $('inquiry-navn').value.trim();
    var kontakt = $('inquiry-kontakt').value.trim();
    var melding = $('inquiry-melding').value.trim();
    var kontaktpreferanse = $('inquiry-kontaktpreferanse').value;
    var kontaktTelefon = kontaktpreferanse === 'begge' ? $('inquiry-telefon-ekstra').value.trim() : '';
    var kontaktEtikett = kontaktpreferanse === 'telefon' ? 'telefon' : kontaktpreferanse === 'epost' ? 'e-post' : 'telefon og e-post';
    var utstyrSvar = [];
    [['sensor', 'regnsensor'], ['antenne', 'antenne i ruten'], ['coated', 'coated']].forEach(function (par) {
      var v = state.profil[par[0]];
      if (v === true || v === false || v === 'unknown') utstyrSvar.push(par[1] + ': ' + (v === 'unknown' ? 'vet ikke' : v ? 'ja' : 'nei'));
    });
    [['hud', 'HUD'], ['ldw', 'LDW'], ['kamera', 'kamera'], ['adas', 'førerassistanse'], ['oppvarmet', 'oppvarmet']].forEach(function (par) {
      var v = state.info[par[0]];
      if (v === true || v === false || v === 'unknown') utstyrSvar.push(par[1] + ': ' + (v === 'unknown' ? 'vet ikke' : v ? 'ja' : 'nei'));
    });
    melding = 'Kontaktmåte: ' + kontaktEtikett + (utstyrSvar.length ? '\nKundens utstyrssvar: ' + utstyrSvar.join(', ') : '') + (melding ? '\n' + melding : '');
    if (melding.length > 500) { inquiryFeil('Meldingen er for lang (maks 500 tegn).'); return; }
    var foretrukket = state.preferredWindshieldCandidate;
    if (!navn || navn.length < 2) { inquiryFeil('Skriv inn navnet ditt (minst 2 tegn).'); return; }
    if (kontaktpreferanse === 'telefon' && !gyldigTelefon(kontakt)) { inquiryFeil('Skriv inn et gyldig telefonnummer med 8 siffer.'); return; }
    if (kontaktpreferanse !== 'telefon' && !gyldigEpost(kontakt)) { inquiryFeil('Skriv inn en gyldig e-postadresse.'); return; }
    if (kontaktpreferanse === 'begge' && !gyldigTelefon(kontaktTelefon)) { inquiryFeil('Skriv inn et gyldig telefonnummer i tillegg til e-postadressen.'); return; }
    var knapp = this;
    var inquiryGeneration = searchGeneration;
    var clientRequestId = null;
    if (state.glassRequest) {
      state.clientRequestId = state.clientRequestId || nyClientRequestId();
      state.inquiryAttempted = true;
      clientRequestId = state.clientRequestId;
    }
    var org = knapp.textContent;
    knapp.disabled = true;
    knapp.textContent = 'Sender…';
    loggHendelse('tilbud_foresporsel', { regnr: regnr, navnLengde: navn.length, kontaktType: /@/.test(kontakt) ? 'epost' : 'telefon' });
    fetch('/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        regnr: regnr, navn: navn, kontakt: kontakt, melding: melding, sessionId: sessionId,
        contactPreference: kontaktpreferanse,
        ...(kontaktpreferanse === 'begge' ? { contactPhone: kontaktTelefon } : {}),
        ...(foretrukket && foretrukket.partNumber ? { preferredCandidate: { partNumber: foretrukket.partNumber, eurocode: foretrukket.eurocode || '', description: foretrukket.description || '' } } : {}),
        ...(state.glassRequest ? { glassRequest: state.glassRequest, clientRequestId: clientRequestId } : {})
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .then(function (r) {
        if (inquiryGeneration !== searchGeneration) return;
        if (!r.ok || !r.data.ok) { var error = new Error(r.data.error || 'Kunne ikke sende forespørselen.'); error.status = r.status; throw error; }
        $('inquiry-form').classList.add('hidden');
        var b = $('inquiry-bekreftet');
        var id = r.data.inquiryId;
        var routeSummary = state.glassRequest ? ' Valgt rute: ' + glassSelectionLabel(state.glassRequest.selection) + '.' : '';
        b.textContent = 'Takk! Vi har mottatt forespørselen' + (id != null ? ' (saksnummer ' + id + ')' : '') + '.' + routeSummary + ' Vi dobbeltsjekker glasset og sender deg pris og levering før du bestemmer deg. Finnbilglass leverer glass, men utfører ikke montering. Du finner selv verksted og avtaler eventuell montering direkte. Partnerverksteder kommer senere.';
        b.className = 'note status pinpoint';
        b.classList.remove('hidden');
      })
      .catch(function (e) {
        if (inquiryGeneration !== searchGeneration) return;
        inquiryFeil(e.message || 'Kunne ikke sende forespørselen. Prøv igjen.');
        if (e.status === 409 && state.glassRequest && state.glassRequest.searchId) visManuellEtterUtloepsvarsel();
      })
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
