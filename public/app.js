/* Finnbilglass.no — frontend-flyt.
   Flyt: skiltnummer (foto/skriv) → glassvalg (bil-info + glasstype) → utstyrs-spørsmål → resultat (API) → tomt.
   API: POST /api/frontrute { merke, modell, aar, profil:{sensor,antenne} }
        POST /api/regnr      { regnr }   ← ALLE skiltnummer lagres (læring).
   Mock-fallback KUN ved file:// (offline demo), tydelig merket som DEMO.
   VERIFY: aldri kandidatspesifikke valg */
(function () {
  'use strict';

  var state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '', vin: null, forstegangsregistrert: null, import: false, importLand: null, resolver: null, currentGlassKind: null, glassRequest: null, clientRequestId: null, inquiryAttempted: false, preferredWindshieldCandidate: null, evidenceSent: false, frontruteKandidater: [] };
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
      state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '', vin: null, forstegangsregistrert: null, import: false, importLand: null, resolver: null, currentGlassKind: null, glassRequest: null, clientRequestId: null, inquiryAttempted: false, preferredWindshieldCandidate: null, evidenceSent: false, frontruteKandidater: [] };
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
      valgTre = null; valgType = null; valgSti = []; valgBak = []; valgteGlass = null;
      if ($('glassvalg')) $('glassvalg').textContent = '';
      if ($('glassvalg-status')) { $('glassvalg-status').textContent = ''; $('glassvalg-status').classList.add('hidden'); }
      if ($('glass-placement')) $('glass-placement').classList.add('hidden');
      if ($('btn-glass-hjelp')) $('btn-glass-hjelp').classList.add('hidden');
      if ($('resultat-oppsummering')) { $('resultat-oppsummering').textContent = ''; $('resultat-oppsummering').classList.add('hidden'); }
      if ($('inquiry-oppsummering')) $('inquiry-oppsummering').textContent = '';
      if ($('inquiry-leveringssted')) $('inquiry-leveringssted').value = '';
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
      headers: inquiryHeaders(),
      body: JSON.stringify({
        regnr: '', navn: name, kontakt: contact, melding: message, sessionId: sessionId,
        manualVehicle: { make: make, model: model, year: year }
      })
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
      })
      .then(function (r) {
        if (!r.ok || !r.data.ok) {
          var error = new Error(fortolkInquiryFeil(r.status, r.data.error));
          error.status = r.status;
          throw error;
        }
        inquiryIdemKey = null;
        show('Takk! Vi har mottatt forespørselen' +
          (r.data.inquiryId != null ? ' (saksnummer ' + r.data.inquiryId + ')' : '') +
          '. Vi kontrollerer bil og glass manuelt før tilbud. Ingen bestilling er gjennomført. Du kan følge saken på Min side: finnbilglass.no/min-side');
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
    // Ny bil = nytt grunnlag. Uten dette ble gamle utstyrssvar, valgt variant og
    // kandidatliste hengende igjen fra forrige søk (målt 2026-11-04).
    frontruteSvar = {};
    valgteGlass = null;
    eksplisittVariantId = null;
    state.frontruteKandidater = [];
    state.frontruteSporsmaal = [];
    state.profil = {};
    $('inquiry-form').classList.add('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('resultat-sporsmaal').textContent = '';
    $('resultat-sporsmaal').classList.add('hidden');
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
    hentGlassValg();
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
      v.textContent = 'Bildata hentet fra Statens vegvesen';
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


  function glassSideLabel(value) {
    return value === 'left' ? 'venstre side' : value === 'right' ? 'høyre side' : '';
  }

  var KROPP_NAVN = { sedan: 'sedan', estate: 'stasjonsvogn', hatchback: '5-dørs', coupe: 'coupé', cabriolet: 'cabriolet', van: 'varebil', suv: 'SUV' };

  // Kort, ærlig plasseringstekst. Ukjente felt utelates i stedet for å skrives
  // som «vet ikke» — oppsummeringen skal leses som et svar, ikke som et skjema.
  function glassSelectionLabel(selection) {
    if (!selection || !selection.kind) return 'Rute ikke valgt';
    var deler = [];
    var legg = function (verdi) { if (verdi) deler.push(verdi); };
    var kropp = selection.body && selection.body !== 'unknown' ? KROPP_NAVN[selection.body] : '';
    if (selection.kind === 'windshield') return 'Frontrute';
    if (selection.kind === 'door') {
      legg('Dørrute');
      legg({ front: 'fremre dør', rear: 'bakre dør', sliding: 'skyvedør' }[selection.door]);
      legg(glassSideLabel(selection.side));
      legg(kropp);
    } else if (selection.kind === 'side') {
      legg('Siderute');
      legg({ front_quarter: 'fremre trekantrute', rear_quarter: 'bakre trekantrute', cargo: 'lasterom' }[selection.section]);
      legg(glassSideLabel(selection.side));
      legg(kropp);
    } else if (selection.kind === 'rear') {
      legg('Bakrute');
      legg(selection.layout === 'split' ? 'delt' : selection.layout === 'single' ? 'hel' : '');
      legg(kropp);
    } else if (selection.kind === 'ventil') {
      legg('Ventilrute');
      legg({ front: 'foran', rear: 'bak' }[selection.placement]);
      legg(glassSideLabel(selection.side));
      legg(kropp);
    } else if (selection.kind === 'roof') {
      legg('Takglass');
      legg({ fixed: 'fast', opening: 'åpningsbart' }[selection.system]);
      legg({ whole: 'hele ruten', front: 'fremre panel', middle: 'midtre panel', rear: 'bakre panel' }[selection.panel]);
    } else {
      return 'Rute ikke valgt';
    }
    if (!deler.length) return 'Rute ikke valgt';
    // Første del er rutetypen (stor forbokstav), resten er presiseringer.
    deler[0] = deler[0].charAt(0).toUpperCase() + deler[0].slice(1);
    return deler.join(' · ');
  }

  // ── Datastyrte rutetype- og plasseringsvalg ───────────────────────────────
  // Valgene kommer fra POST /api/glass/valg, som bygger et tre fra bilens
  // dokumenterte kandidater. Frontend kan derfor ikke tilby en kombinasjon
  // katalogen ikke har, og et steg med ett reelt alternativ hoppes over —
  // men valget følger med i oppsummeringen.
  var valgTre = null;
  var valgType = null;
  var valgSti = [];        // kundens valg: [{felt, verdi, tittel}]
  var valgBak = [];        // sti-lengde før hvert kundesteg (for «Tilbake»)
  var valgteGlass = null;  // valgt kandidat fra resultatlisten
  // Kundens EKSPLISITTE valg («Velg dette glasset») når flere varianter vises.
  // Auto-valg brukes bare når nøyaktig én kandidat gjenstår; et eksplisitt valg
  // skal ikke overstyres så lenge varianten fortsatt er blant kandidatene.
  var eksplisittVariantId = null;

  var FELT_SPORSMAL = {
    door: 'Hvilken dørrute gjelder det?',
    side: 'Hvilken side av bilen?',
    placement: 'Hvor sitter ventilruten?',
    layout: 'Er bakruten hel eller delt?',
    section: 'Hvor sitter sideruten?',
    mounting: 'Hvor er ruten festet?',
    system: 'Er takglasset fast eller åpningsbart?',
    panel: 'Hvilket panel gjelder det?',
    body: 'Hvilken karosseritype er bilen?'
  };

  // Speiler feltrekkefølgen i kontrakten (src/glass-selection-contract.ts).
  var VALG_FELTER = {
    windshield: [],
    door: ['side', 'door', 'body'],
    side: ['side', 'section', 'mounting', 'body'],
    rear: ['layout', 'splitSide', 'body'],
    ventil: ['side', 'placement', 'body'],
    roof: ['system', 'panel']
  };

  function byggSelection(kind, svar) {
    var sel = { kind: kind };
    (VALG_FELTER[kind] || []).forEach(function (felt) {
      // Kontrakten avviser splitSide når layout ikke er «split».
      if (felt === 'splitSide' && svar.layout !== 'split') return;
      sel[felt] = svar[felt] || 'unknown';
    });
    return sel;
  }

  // Henter bilens dokumenterte rutevalg. Kalles hver gang en bil er identifisert.
  function hentGlassValg() {
    var boks = $('glassvalg');
    var status = $('glassvalg-status');
    valgTre = null;
    valgType = null;
    valgSti = [];
    valgBak = [];
    if (boks) boks.textContent = '';
    $('glass-placement').classList.add('hidden');
    $('btn-glass-hjelp').classList.add('hidden');
    if (!state.merke) return;
    status.textContent = 'Henter hvilke ruter som er dokumentert for bilen …';
    status.classList.remove('hidden');
    var generation = searchGeneration;
    fetch('/api/glass/valg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regnr: state.regnr, merke: state.merke, modell: state.modell, aar: state.aar })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (generation !== searchGeneration) return;
        if (!data || data.ok !== true) {
          visValgHjelp('Vi fikk ikke hentet rutevalgene akkurat nå. Send oss en forespørsel, så hjelper vi deg videre.');
          return;
        }
        valgTre = data;
        renderGlassTyper();
      })
      .catch(function () {
        if (generation !== searchGeneration) return;
        visValgHjelp('Vi fikk ikke hentet rutevalgene akkurat nå. Send oss en forespørsel, så hjelper vi deg videre.');
      });
  }

  // Ingen data, teknisk feil eller tom katalog: kunden skal aldri møte en tom
  // valgboks, men en forklaring og en vei videre.
  function visValgHjelp(melding) {
    var status = $('glassvalg-status');
    status.textContent = melding;
    status.classList.remove('hidden');
    $('glassvalg').textContent = '';
    $('glass-placement').classList.add('hidden');
    $('btn-glass-hjelp').classList.remove('hidden');
  }

  function renderGlassTyper() {
    var boks = $('glassvalg');
    var status = $('glassvalg-status');
    boks.textContent = '';
    var typer = valgTre && Array.isArray(valgTre.typer) ? valgTre.typer : [];
    if (!typer.length) {
      visValgHjelp((valgTre && valgTre.melding) || 'Vi fant ingen mulige glassvarianter til denne bilen. Send oss en forespørsel, så undersøker vi videre.');
      return;
    }
    var antallGlass = Number(valgTre.antallKandidater || 0);
    status.textContent = (valgTre.melding || 'Velg ruten det gjelder.')
      + (antallGlass ? ' ' + antallGlass + ' mulige glassvarianter for denne bilen.' : '');
    status.classList.remove('hidden');
    typer.forEach(function (type) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'glassopt';
      // data-type beholder de gamle verdiene (front/…) slik at smoke- og
      // E2E-scriptene finner knappene; data-kind er API-ets rutetype.
      b.setAttribute('data-type', type.kind === 'windshield' ? 'front' : type.kind);
      b.setAttribute('data-kind', type.kind);
      b.setAttribute('aria-pressed', 'false');
      var tittel = document.createElement('span');
      tittel.className = 'glassopt-title';
      tittel.textContent = type.tittel;
      var hjelp = document.createElement('span');
      hjelp.className = 'glassopt-help';
      hjelp.textContent = type.kind === 'windshield'
        ? (!type.antall ? 'Vi søker i frontrutedataene' : type.antall === 1 ? '1 mulig frontrute' : type.antall + ' mulige frontruter')
        : (!type.antall ? 'Vi kontrollerer denne ruten manuelt' : type.antall === 1 ? '1 mulig glassvariant' : type.antall + ' mulige glassvarianter');
      b.appendChild(tittel);
      b.appendChild(hjelp);
      b.addEventListener('click', function () { velgRutetype(type); });
      boks.appendChild(b);
    });
    $('btn-glass-hjelp').classList.remove('hidden');
  }

  function velgRutetype(type) {
    valgType = type;
    valgSti = [];
    valgBak = [];
    searchGeneration++;
    document.querySelectorAll('.glassopt[data-type]').forEach(function (b) {
      var aktiv = b.getAttribute('data-kind') === type.kind;
      b.classList.toggle('aktiv', aktiv);
      b.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
    });
    $('glass-placement-error').classList.add('hidden');
    $('resultat-kort').textContent = '';
    $('resultat-alt').textContent = '';
    $('btn-inquiry').disabled = true;
    $('inquiry-form').classList.add('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    state.currentGlassKind = type.kind;
    state.glassRequest = null;
    state.clientRequestId = null;
    // Tilbake skal være tilgjengelig også i frontrute-flyten, ikke bare i treet.
    $('btn-glass-back').classList.remove('hidden');
    loggHendelse('velg_rutetype', { kind: type.kind, antall: type.antall });
    visValg();
  }

  // Går gjennom kundens valg og hopper over steg der bare ett alternativ finnes.
  function gaaGjennom(noder, sti) {
    var auto = [];
    for (var i = 0; i < sti.length; i++) {
      var funnet = null;
      for (var j = 0; j < noder.length; j++) {
        if (noder[j].felt === sti[i].felt && noder[j].verdi === sti[i].verdi) { funnet = noder[j]; break; }
      }
      // «Vet ikke» finnes ikke som node — det er et gyldig sluttvalg uten filter.
      if (!funnet) return { barn: [], auto: auto };
      noder = funnet.barn || [];
    }
    while (noder.length === 1) {
      auto.push(noder[0]);
      noder = noder[0].barn || [];
    }
    return { barn: noder, auto: auto };
  }

  function visValg() {
    if (!valgType) return;
    var r = gaaGjennom(valgType.barn || [], valgSti);
    if (!r.barn.length) { fullforValg(r.auto); return; }
    renderValgSteg(r.barn, r.auto);
  }

  function stiTekst(auto) {
    var deler = [];
    if (valgType) deler.push(valgType.tittel);
    valgSti.forEach(function (v) { deler.push(v.tittel); });
    (auto || []).forEach(function (n) { deler.push(n.tittel); });
    return deler.join(' › ');
  }

  function renderValgSteg(noder, auto) {
    var sporsmaal = (valgTre && valgTre.sporsmaal) || FELT_SPORSMAL;
    var felt = noder[0].felt;
    $('glass-placement').classList.remove('hidden');
    $('glass-sti').textContent = stiTekst(auto);
    $('glass-placement-title').textContent = sporsmaal[felt] || 'Velg et alternativ';
    var hjelp = felt === 'side' ? ((valgTre && valgTre.sidehjelp) || '') : '';
    $('glass-placement-help').textContent = hjelp;
    $('glass-placement-help').classList.toggle('hidden', !hjelp);

    var boks = $('glass-placement-fields');
    boks.textContent = '';
    noder.forEach(function (node) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'valg-knapp';
      b.setAttribute('data-verdi', node.verdi);
      var tittel = document.createElement('span');
      tittel.className = 'valg-tittel';
      tittel.textContent = node.tittel;
      var meta = document.createElement('span');
      meta.className = 'valg-meta';
      meta.textContent = node.antall === 1 ? '1 dokumentert glass' : node.antall + ' dokumenterte glass';
      b.appendChild(tittel);
      b.appendChild(meta);
      b.addEventListener('click', function () { velgValgNode(node); });
      boks.appendChild(b);
    });
    // Siden kan kunden faktisk være usikker på. «Vet ikke» filtrerer ingenting
    // og sender begge sider videre til kontroll.
    if (felt === 'side') {
      var vetikke = document.createElement('button');
      vetikke.type = 'button';
      vetikke.className = 'valg-knapp valg-vetikke';
      vetikke.setAttribute('data-verdi', 'unknown');
      var t = document.createElement('span');
      t.className = 'valg-tittel';
      t.textContent = 'Vet ikke hvilken side';
      var m = document.createElement('span');
      m.className = 'valg-meta';
      m.textContent = 'Vi kontrollerer begge sider';
      vetikke.appendChild(t);
      vetikke.appendChild(m);
      vetikke.addEventListener('click', function () {
        velgValgNode({ felt: 'side', verdi: 'unknown', tittel: 'Vet ikke hvilken side', barn: [], automatisk: {} });
      });
      boks.appendChild(vetikke);
    }

    $('btn-glass-back').classList.toggle('hidden', !valgBak.length);
    $('glass-placement-title').focus();
  }

  function velgValgNode(node) {
    valgBak.push(valgSti.length);
    valgSti.push({ felt: node.felt, verdi: node.verdi, tittel: node.tittel });
    loggHendelse('valg_plassering', { kind: valgType ? valgType.kind : null, felt: node.felt, verdi: node.verdi });
    visValg();
  }

  function valgTilbake() {
    if (valgBak.length) {
      valgSti = valgSti.slice(0, valgBak.pop());
      $('glass-placement-error').classList.add('hidden');
      visValg();
      return;
    }
    // Frontrute-flyten går via resolveren og har ingen valgsti. «Tilbake» skal
    // da føre til rutevalget igjen. Svaret og en eventuell valgt variant
    // nullstilles, slik at et gammelt valg aldri blir hengende på en ny rute.
    if (!state.currentGlassKind) return;
    searchGeneration++;
    state.currentGlassKind = null;
    state.glassRequest = null;
    state.clientRequestId = null;
    valgteGlass = null;
    valgType = null;
    valgSti = [];
    valgBak = [];
    $('glass-placement').classList.add('hidden');
    $('resultat-kort').textContent = '';
    $('resultat-alt').textContent = '';
    // Svaret hører til ruten vi forlot og er ugyldig etter «Tilbake».
    frontruteSvar = {};
    if ($('resultat-sporsmaal')) { $('resultat-sporsmaal').textContent = ''; $('resultat-sporsmaal').classList.add('hidden'); }
    if ($('resultat-oppsummering')) $('resultat-oppsummering').textContent = '';
    $('btn-inquiry').disabled = true;
    $('inquiry-form').classList.add('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('btn-glass-back').classList.add('hidden');
    renderGlassTyper();
  }

  // Slår sammen automatiske valg, hoppede steg og kundens svar til ett
  // selection-objekt. Felt katalogen ikke skiller på blir «unknown».
  function fullforValg(auto) {
    if (!valgType) return;
    var svar = {};
    if (valgType.automatisk) Object.keys(valgType.automatisk).forEach(function (k) { svar[k] = valgType.automatisk[k]; });
    (auto || []).forEach(function (n) {
      var a = n.automatisk || {};
      Object.keys(a).forEach(function (k) { svar[k] = a[k]; });
    });
    valgSti.forEach(function (v) { svar[v.felt] = v.verdi; });
    $('glass-placement').classList.add('hidden');
    valgBak = [];
    sokGlass(byggSelection(valgType.kind, svar));
  }

  // ── Resultat: oppsummering, hjelpetilstand og kandidatkort ────────────────

  // Valgt bil og plassering vises øverst på resultatet. Uten dette må kunden
  // huske hva hun valgte tre skjermer tilbake.
  function visResultatOppsummering(selection) {
    var el = $('resultat-oppsummering');
    if (!el) return;
    el.textContent = '';
    // SVVs handelsbetegnelse inneholder ofte merket selv («TOYOTA RAV4»).
    // Da skal merket ikke prependeres — ellers blir det «Toyota Toyota RAV4».
    var merkePent = penSkrivemaate(state.merke);
    var modellPent = penSkrivemaate(state.modell);
    var modellHarMerke = modellPent.toUpperCase().indexOf(String(state.merke || '').toUpperCase().trim()) === 0;
    var bil = [modellHarMerke ? '' : merkePent, modellPent, state.aar ? String(state.aar) : '']
      .filter(Boolean).join(' ');
    var dl = document.createElement('dl');
    var rad = function (etikett, verdi) {
      if (!verdi) return;
      var dt = document.createElement('dt');
      dt.textContent = etikett;
      var dd = document.createElement('dd');
      dd.textContent = verdi;
      dl.appendChild(dt);
      dl.appendChild(dd);
    };
    rad('Bil', bil ? bil + (state.regnr ? ' · ' + state.regnr : '') : state.regnr);
    rad('Rute', glassSelectionLabel(selection));
    rad('Vi kontrollerer', 'riktig variant, pris og levering før du får tilbud');
    if (!dl.children.length) { el.classList.add('hidden'); return; }
    el.appendChild(dl);
    el.classList.remove('hidden');
    // Kjennemerket står allerede i oppsummeringen.
    if ($('resultat-regnr')) $('resultat-regnr').classList.add('hidden');
  }

  // Felles avslutning av et resultat: skjema og oppsummering skal alltid være
  // i takt med det kunden faktisk har valgt.
  function avsluttResultat(request) {
    state.glassRequest = request;
    state.clientRequestId = null;
    state.evidenceSent = false;
    $('inquiry-regnr').value = state.regnr || '';
    $('inquiry-form').classList.add('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('btn-inquiry').disabled = false;
    oppdaterSoknadOppsummering();
    show('resultat');
  }

  // Hjelpetilstand: ingen data, «finner ikke ruten» eller teknisk feil.
  // Kunden skal aldri måtte skrive inn bilen på nytt.
  function visManuellHjelp(tittel) {
    var request = { schemaVersion: 1, selection: { kind: 'unknown' }, answers: {} };
    var h2 = $('screen-resultat').querySelector('h2');
    var status = $('resultat-status');
    h2.textContent = 'Vi hjelper deg videre';
    status.textContent = 'Vi har ikke nok opplysninger til å peke på én rute. Send oss en forespørsel, så undersøker vi bilen manuelt — du trenger ikke skrive den inn på nytt.';
    status.className = 'note status manual';
    status.classList.remove('hidden');
    $('resultat-kort').textContent = '';
    $('resultat-alt').textContent = '';
    $('resultat-sporsmaal').classList.add('hidden');
    $('resultat-kort').classList.remove('hidden');
    var note = document.createElement('p');
    note.className = 'note';
    note.textContent = tittel ? 'Du valgte: ' + tittel + '. Vi kontrollerer hvilken rute og hvilket glass bilen bruker.' : 'Vi kontrollerer hvilken rute og hvilket glass bilen bruker.';
    $('resultat-kort').appendChild(note);
    visResultatOppsummering(request.selection);
    avsluttResultat(request);
    $('inquiry-form').classList.remove('hidden');
  }

  // Forskjellene mellom alternativene er det kunden faktisk velger på.
  function forskjellFra(k, alle) {
    if (!alle || alle.length < 2) return '';
    var mine = Array.isArray(k.egenskaper) ? k.egenskaper : [];
    var mitt = {};
    mine.forEach(function (e) { mitt[e] = true; });
    var andres = {};
    alle.forEach(function (x) { if (x !== k) (x.egenskaper || []).forEach(function (e) { andres[e] = true; }); });
    var unike = mine.filter(function (e) { return !andres[e]; });
    var andreForst = alle.filter(function (x) { return x !== k; })[0];
    var mangler = ((andreForst && andreForst.egenskaper) || []).filter(function (e) { return !mitt[e]; });
    var deler = [];
    if (unike.length) deler.push('har ' + unike.join(' og ') + ' som de andre ikke har');
    if (mangler.length) deler.push('mangler ' + mangler.join(' og ') + ' som et annet alternativ har');
    return deler.length ? 'Skillende: ' + deler.join('; ') + '.' : 'Samme dokumenterte egenskaper som de andre alternativene.';
  }

  function kandidatKort(k, alle) {
    var kort = document.createElement('article');
    kort.className = 'kandidat-kort';
    kort.setAttribute('data-varenr', k.varenr || '');

    var navn = document.createElement('h3');
    navn.textContent = k.varenavn || 'Glass';
    kort.appendChild(navn);

    var posisjon = document.createElement('p');
    posisjon.className = 'kandidat-posisjon';
    posisjon.textContent = String(k.posisjon || 'Plassering må avklares')
      .replace(/\(type må avklares\)/i, '— vi avklarer hvilken type')
      .replace(/^Plassering må avklares$/i, 'Vi avklarer hvilken rute dette er');
    kort.appendChild(posisjon);

    var eg = document.createElement('ul');
    eg.className = 'kandidat-egenskaper';
    var egenskaper = Array.isArray(k.egenskaper) && k.egenskaper.length
      ? k.egenskaper
      : ['Egenskaper er ikke dokumentert i katalogen'];
    egenskaper.forEach(function (e) {
      var li = document.createElement('li');
      li.textContent = e;
      eg.appendChild(li);
    });
    kort.appendChild(eg);

    var forskjell = forskjellFra(k, alle);
    if (forskjell) {
      var f = document.createElement('p');
      f.className = 'note kandidat-forskjell';
      f.textContent = forskjell;
      kort.appendChild(f);
    }
    if (k.varianter > 1) {
      var v = document.createElement('p');
      v.className = 'note kandidat-varianter';
      v.textContent = k.varianter + ' varianter med samme dokumenterte egenskaper — vi avklarer hvilken som er riktig.';
      kort.appendChild(v);
    }

    var pris = document.createElement('p');
    pris.className = 'kandidat-pris';
    pris.textContent = 'Pris på forespørsel';
    var prisnote = document.createElement('span');
    prisnote.textContent = ' Vi oppgir pris inkl. mva. og levering i tilbudet.';
    pris.appendChild(prisnote);
    kort.appendChild(pris);

    var velg = document.createElement('button');
    velg.type = 'button';
    velg.className = 'sek velg-glass';
    velg.textContent = 'Velg dette glasset';
    velg.setAttribute('aria-pressed', 'false');
    velg.addEventListener('click', function () {
      // variantId følger valget: ett varenr kan ha flere dokumenterte eurokoder
      // (målt 2026-11-04: 8432AGAC har åtte). Uten den ville «samme glass» kunne
      // peke på en annen variant i innsendingen enn den kunden så.
      valgteGlass = { varenr: k.varenr || '', varenavn: k.varenavn || '', posisjon: k.posisjon || '',
        variantId: k.variantId || null, eurokode: k.eurokode || null };
      document.querySelectorAll('.kandidat-kort').forEach(function (kortEl) {
        var aktiv = kortEl === kort;
        kortEl.classList.toggle('valgt', aktiv);
        var knapp = kortEl.querySelector('.velg-glass');
        if (knapp) {
          knapp.setAttribute('aria-pressed', aktiv ? 'true' : 'false');
          knapp.textContent = aktiv ? 'Valgt' : 'Velg dette glasset';
        }
      });
      loggHendelse('velg_glass', { varenr: k.varenr || null, posisjon: k.posisjon || null });
      oppdaterSoknadOppsummering();
    });
    kort.appendChild(velg);
    return kort;
  }

  function sokGlass(selection) {
    var generation = ++searchGeneration;

    // «Vet ikke hvilken rute» er ikke et katalogsøk uten filter — det er en
    // hjelpeforespørsel. Uten dette ville kunden fått alle bilens glass uten
    // plasseringssammenheng.
    if (selection && selection.kind === 'unknown') {
      visManuellHjelp('Vet ikke hvilken rute');
      return;
    }

    var request = {
      schemaVersion: 1,
      selection: selection,
      answers: {}
    };

    // 3. ALL_GLASS_CANDIDATES: Oppdatert API-flyt for ALLE glassklasser (V6.6.0-C).
    if (selection && selection.kind === 'windshield') {
      sokFrontrute(request, generation);
      return;
    }

    // C6.0-C: Utvidet søk for andre glasstyper (dør, side, bak, ventil, tak).
    // Bruker nå samme sikre backend-flyt som frontrute.
    sokGlasskategori(request, generation);
  }

  // Ny kategorisøk-funksjon (lik sokFrontrute, men for alle klasser)
  function sokGlasskategori(request, generation) {
    var V = window.FBGView;
    state.glassRequest = request;
    state.clientRequestId = null;

    $('resultat-kort').textContent = '';
    $('resultat-alt').textContent = '';
    $('resultat-sporsmaal').classList.add('hidden');
    $('btn-inquiry').disabled = true;
    $('inquiry-form').classList.add('hidden');
    $('screen-resultat').querySelector('h2').textContent = 'Søker etter glass…';
    var info = $('resultat-status');
    info.textContent = 'Vi henter glasskandidater til bilen din.';
    info.className = 'note status';
    info.classList.remove('hidden');
    show('resultat');

    fetch('/api/glass/kandidater', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Bilen er allerede identifisert i kundereisen. Send merke/modell/år i
        // tillegg til regnr, så svaret ikke avhenger av et nytt SVV-oppslag.
        regnr: state.regnr,
        merke: state.merke,
        modell: state.modell,
        aar: state.aar,
        schemaVersion: request.schemaVersion,
        selection: request.selection,
        answers: request.answers || {}
      })
    })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (generation !== searchGeneration) return;
      renderGlassResultat(request, data, generation);
    })
    .catch(function () {
      if (generation !== searchGeneration) return;
      $('screen-resultat').querySelector('h2').textContent = 'Vi fikk ikke hentet glasset akkurat nå';
      info.textContent = 'Dette er en teknisk feil hos oss, ikke en beskjed om at glasset mangler. Prøv igjen om litt, eller send oss en forespørsel — vi kontrollerer gjerne bilen manuelt.';
      info.className = 'note status teknisk-feil';
      info.classList.remove('hidden');
      $('btn-inquiry').disabled = false;
      avsluttResultat(request);
    });
  }

  function renderGlassResultat(request, data, generation) {
    if (generation !== searchGeneration) return;
    var h2 = $('screen-resultat').querySelector('h2');
    var status = $('resultat-status');
    valgteGlass = null;
    $('resultat-kort').textContent = '';
    $('resultat-kort').classList.remove('hidden');
    $('resultat-alt').textContent = '';
    $('resultat-sporsmaal').classList.add('hidden');
    $('tilbehor-seksjon').classList.add('hidden');
    visResultatOppsummering(request.selection);

    // Fire tilstander skal se ulike ut: ingen treff, flere mulige, manglende
    // opplysninger og teknisk feil. En felles «noe gikk galt» skjuler forskjellen.
    if (!data || typeof data !== 'object' || data.ok === false) {
      h2.textContent = 'Vi fikk ikke hentet glasset akkurat nå';
      status.textContent = 'Prøv igjen om litt, eller send oss en forespørsel. Vi kontrollerer gjerne bilen manuelt.';
      status.className = 'note status teknisk-feil';
      status.classList.remove('hidden');
      avsluttResultat(request);
      return;
    }

    var kandidater = Array.isArray(data.kandidater) ? data.kandidater : [];
    if (!kandidater.length) {
      h2.textContent = 'Vi kontrollerer ruten manuelt';
      status.textContent = data.message || 'Vi må kontrollere hvilken rute bilen bruker før vi kan bekrefte riktig glass.';
      status.className = 'note status manual';
      status.classList.remove('hidden');
      var hjelp = document.createElement('p');
      hjelp.className = 'note';
      hjelp.textContent = 'Du trenger ikke skrive inn bilen på nytt. Send forespørselen, så undersøker vi videre.';
      $('resultat-kort').appendChild(hjelp);
      avsluttResultat(request);
      return;
    }

    // Kandidater vises bare når serveren faktisk har dem (ALL_GLASS_KANDIDATER_ENABLED).
    // Katalogen bekrefter ikke fysisk kompatibilitet: hvert kort merkes «må kontrolleres»,
    // og eurokode/leverandørdata vises aldri (public-contract.ts).
    h2.textContent = 'Mulige glass til bilen din';
    status.textContent = data.message || 'Vi har funnet mulige glass. Riktig variant avhenger av bilens utstyr — vi kontrollerer valget før du får pris og levering.';
    status.className = 'note status verify';
    status.classList.remove('hidden');

    var maks = 6;
    var liste = document.createElement('div');
    liste.className = 'kandidat-liste';
    kandidater.slice(0, maks).forEach(function (k) {
      liste.appendChild(kandidatKort(k, kandidater));
    });
    $('resultat-kort').appendChild(liste);

    if (kandidater.length > maks) {
      var mer = document.createElement('p');
      mer.className = 'note';
      mer.textContent = 'Viser ' + maks + ' av ' + kandidater.length + ' mulige glass. Vi kontrollerer hvilke av dem som er riktig for bilen din.';
      $('resultat-kort').appendChild(mer);
    }
    var merknad = document.createElement('p');
    merknad.className = 'note';
    merknad.textContent = 'Krever kontroll før bestilling — katalogen bekrefter ikke at glasset passer bilen.';
    $('resultat-kort').appendChild(merknad);

    avsluttResultat(request);
  }


  // ── Frontrutesøk mot /api/frontrute (P0 2026-10-31) ─────────────────────
  // Kandidater vises, men katalogen bekrefter aldri fysisk kompatibilitet:
  // PINPOINT = én identifisert variant, VERIFY = flere varianter som skilles av
  // utstyrsspørsmål, MANUAL_REVIEW = vi kan ikke peke på én.
  var frontruteSvar = {};

  function sokFrontrute(request, generation) {
    var V = window.FBGView;
    frontruteSvar = {};
    state.frontruteKandidater = [];
    request.answers = {};
    state.glassRequest = request;
    state.clientRequestId = null;

    $('resultat-kort').textContent = '';
    $('resultat-alt').textContent = '';
    $('resultat-sporsmaal').classList.add('hidden');
    $('resultat-sporsmaal').textContent = '';
    $('tilbehor-seksjon').classList.add('hidden');
    $('btn-inquiry').disabled = true;
    $('inquiry-form').classList.add('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('screen-resultat').querySelector('h2').textContent = 'Søker etter frontrute…';
    $('resultat-regnr').textContent = state.regnr ? 'Kjennemerke: ' + state.regnr : '';
    $('resultat-regnr').classList.toggle('hidden', !state.regnr);
    var info = $('resultat-status');
    info.textContent = 'Vi henter frontruter til bilen din.';
    info.className = 'note status';
    info.classList.remove('hidden');
    show('resultat');

    fetch('/api/frontrute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merke: state.merke,
        modell: state.modell,
        aar: state.aar,
        vin: state.vin,
        profil: state.profil
      })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (generation !== searchGeneration) return;
        renderFrontrute(request, data, generation);
      })
      .catch(function () {
        if (generation !== searchGeneration) return;
        var V2 = window.FBGView;
        $('screen-resultat').querySelector('h2').textContent = 'Vi fikk ikke hentet frontruten akkurat nå';
        var feil = $('resultat-status');
        feil.textContent = 'Prøv igjen om litt, eller ring oss på 40 40 82 41. Vi kontrollerer gjerne bilen manuelt.';
        feil.className = 'note status';
        feil.classList.remove('hidden');
        $('btn-inquiry').disabled = false;
        state.frontruteKandidater = [];
        void V2;
      });
  }

  function renderFrontrute(request, data, generation) {
    if (generation !== searchGeneration) return;
    var V = window.FBGView;
    // Sikker mot null/undefined data fra API-et
    if (!data || typeof data !== 'object') {
      data = { kandidater: [], utfall: null, message: 'Ugyldig svar fra serveren.' };
    }
    var kandidater = Array.isArray(data.kandidater) ? data.kandidater : [];
    var utfall = typeof data.utfall === 'string' ? data.utfall : null;
    // Uavhengig evidens (OE/bilde/montør) kommer fra API-et; default false
    // per C9-doktrinen: katalog alene gir aldri EXACT.
    var harUavhengigEvidens = typeof data.harUavhengigEvidens === 'boolean' ? data.harUavhengigEvidens : false;
    var status = V.resultatStatus(utfall, kandidater.length, harUavhengigEvidens);

    state.frontruteKandidater = kandidater;
    state.glassRequest = request;
    $('screen-resultat').querySelector('h2').textContent = status.tittel;
    var info = $('resultat-status');
    info.textContent = data.message || status.melding;
    info.className = 'note status' + (status.kode === 'AMBIGUOUS' ? ' verify' : status.kode === 'EXACT' ? ' exact' : '');
    info.classList.remove('hidden');

    // Pristilbud og manuell kontroll skal ALLTID være tilgjengelig,
    // uavhengig av glassstatus (EXACT, PROVISIONAL, AMBIGUOUS, MANUAL_REVIEW).
    // Ingen kunde skal bli nektet manuell forespørsel fordi glasset er usikkert.
    // Direkt kjøp (canCheckout) krever ytterligere server-side kontroller og
    // er IKTE knyttet til dette UI-feltet alene.
    var inquiryBtn = $('btn-inquiry');
    if (inquiryBtn) inquiryBtn.disabled = false;

    $('resultat-kort').textContent = '';
    $('resultat-alt').textContent = '';

    if (!kandidater.length) {
      $('btn-inquiry').disabled = false;
      $('resultat-sporsmaal').classList.add('hidden');
      $('inquiry-glass-summary').textContent = glassSelectionLabel(request.selection);
      $('inquiry-glass-summary').classList.remove('hidden');
      $('inquiry-regnr').value = state.regnr || '';
      return;
    }

    var vist = V.filtrerPaaSvar(kandidater, frontruteSvar);
    var liste = vist.kandidater;
    // Kundens valg: eksplisitt «Velg dette glasset» vinner så lenge varianten
    // fortsatt er blant de synlige kandidatene. Gjenstår bare én kandidat, er
    // den valgt automatisk. Endres kandidatlisten slik at et eksplisitt valg
    // ikke lenger er gyldig, nullstilles det (ingen skjult gammel variant).
    state.frontruteSporsmaal = Array.isArray(data && data.sporsmaal) ? data.sporsmaal : (state.frontruteSporsmaal || []);
    var valgt = null;
    if (eksplisittVariantId) {
      valgt = liste.filter(function (k) { return (k.variantId || '') === eksplisittVariantId; })[0] || null;
      if (!valgt) eksplisittVariantId = null;
    }
    if (!valgt && liste.length === 1) valgt = liste[0];
    valgteGlass = valgt ? {
      varenr: valgt.varenr || '',
      varenavn: valgt.varenavn || '',
      // Eurokoden vises aldri til kunden (Tom 2026-10-31); den utledes bare
      // internt fra variantId for sporing i saken.
      eurokode: (valgt.variantId || '').indexOf(':') > 0 ? String(valgt.variantId).split(':').slice(1).join(':') : null,
      variantId: valgt.variantId || null,
      posisjon: (valgt.posisjon && valgt.posisjon.glassklasse) || ''
    } : null;

    // Ekstra sikring: aldri kall kandidatKort på en tom liste.
    if (!liste || !liste.length) {
      $('resultat-sporsmaal').classList.add('hidden');
      $('inquiry-glass-summary').textContent = glassSelectionLabel(request.selection);
      $('inquiry-glass-summary').classList.remove('hidden');
      $('inquiry-regnr').value = state.regnr || '';
      return;
    }

    // Hovedkort: første kandidat.
    var hoved = V.kandidatKort(liste[0]);
    $('resultat-kort').textContent = '';

    // Status-basert merking av hovedkortet.
    if (status.kode === 'PROVISIONAL') {
      var midlertidig = document.createElement('p');
      midlertidig.className = 'note provisional';
      midlertidig.textContent = 'Midlertidig treff — mangler uavhengig bekreftelse før bestilling.';
      $('resultat-kort').append(midlertidig);
    } else if (status.kode === 'AMBIGUOUS') {
      var tvetydig = document.createElement('p');
      tvetydig.className = 'note ambiguous';
      tvetydig.textContent = 'Flere mulige varianter — velg utstyr nedenfor for å avgrense.';
      $('resultat-kort').append(tvetydig);
    } else if (status.kode === 'MANUAL_REVIEW') {
      var manuell = document.createElement('p');
      manuell.className = 'note manual';
      manuell.textContent = 'Vi kontrollerer ruten manuelt før vi kan bekrefte riktig glass.';
      $('resultat-kort').append(manuell);
    }

    var tittel = document.createElement('strong');
    tittel.textContent = hoved.navn;
    $('resultat-kort').append(tittel);
    var pris = document.createElement('p');
    pris.className = 'pris';
    pris.textContent = hoved.pris.tekst;
    $('resultat-kort').append(pris);
    if (hoved.pris.detalj) {
      var detalj = document.createElement('p');
      detalj.className = 'muted';
      detalj.textContent = hoved.pris.detalj;
      $('resultat-kort').append(detalj);
    }
    if (hoved.egenskaper.length) {
      var egen = document.createElement('p');
      egen.className = 'muted';
      egen.textContent = 'Utstyr: ' + hoved.egenskaper.join(', ');
      $('resultat-kort').append(egen);
    }
    // Eksplisitt valg også når flere varianter vises: kunden kan peke på den
    // ruten hun mener bilen har. Valget valideres server-side mot bilens
    // kandidatsett før saken lagres.
    leggTilVelgKnapp($('resultat-kort'), liste[0]);

    // Øvrige kandidater
    if (liste.length > 1) {
      var altTittel = document.createElement('p');
      altTittel.className = 'muted';
      altTittel.textContent = 'Andre mulige varianter:';
      $('resultat-alt').append(altTittel);
      for (var i = 1; i < liste.length; i++) {
        var k = V.kandidatKort(liste[i]);
        var rad = document.createElement('div');
        rad.className = 'alt-rad';
        rad.setAttribute('data-variant', liste[i].variantId || '');
        var navn = document.createElement('span');
        navn.textContent = k.navn + (k.egenskaper.length ? ' · ' + k.egenskaper.join(', ') : '');
        var p = document.createElement('span');
        p.className = 'alt-pris';
        p.textContent = k.pris.tekst;
        rad.append(navn, p);
        var velgAlt = document.createElement('button');
        velgAlt.type = 'button';
        velgAlt.className = 'sek velg-glass small' + ((liste[i].variantId || '') === eksplisittVariantId ? ' valgt' : '');
        velgAlt.textContent = (liste[i].variantId || '') === eksplisittVariantId ? 'Valgt' : 'Velg dette glasset';
        velgAlt.setAttribute('aria-pressed', (liste[i].variantId || '') === eksplisittVariantId ? 'true' : 'false');
        (function (valgtKandidat) {
          velgAlt.addEventListener('click', function () { velgFrontruteKandidat(valgtKandidat); });
        })(liste[i]);
        rad.append(velgAlt);
        $('resultat-alt').append(rad);
      }
    }

    // Totalantall vises bare når den etablerte grensen (6) faktisk kappet listen —
    // ellers ville «Viser 1 av 2» sett ut som filtrering/paginering.
    var totalt = Number(data.totalAntall || kandidater.length);
    var antall = totalt > 6 ? V.antallTekst(Math.min(liste.length, 6), totalt) : null;
    if (antall) {
      var a = document.createElement('p');
      a.className = 'muted';
      a.textContent = antall;
      $('resultat-alt').append(a);
    }

    // Utstyrsspørsmål — bare de som faktisk skiller kandidatene.
    renderFrontruteSporsmaal(Array.isArray(data.sporsmaal) ? data.sporsmaal : []);

    $('inquiry-regnr').value = state.regnr || '';
    $('inquiry-glass-summary').textContent = glassSelectionLabel(request.selection);
    $('inquiry-glass-summary').classList.remove('hidden');
    $('btn-inquiry').disabled = false;
    visResultatOppsummering(request.selection);
    oppdaterSoknadOppsummering();
  }

  function svartekstFor(felt) {
    var verdi = frontruteSvar[felt];
    var alt = window.FBGView.svarAlternativer(felt).filter(function (a) { return a.verdi === verdi; })[0];
    return alt ? alt.tekst : String(verdi || '');
  }

  /** «Velg dette glasset» på frontrute-kandidatene. Setter kundens eksplisitte
   *  valg, oppdaterer oppsummeringen og merker kortet — uten å endre svarene. */
  function velgFrontruteKandidat(kandidat) {
    if (!kandidat) return;
    eksplisittVariantId = kandidat.variantId || null;
    renderFrontrute(state.glassRequest, {
      kandidater: state.frontruteKandidater,
      utfall: state.frontruteKandidater.length === 1 ? 'PINPOINT' : 'VERIFY',
      sporsmaal: state.frontruteSporsmaal || []
    }, searchGeneration);
  }

  /** Legger «Velg dette glasset»-knapp på et kandidatkort. */
  function leggTilVelgKnapp(container, kandidat) {
    if (!container || !kandidat || !kandidat.variantId) return;
    var erValgt = (kandidat.variantId || '') === eksplisittVariantId
      || ((state.frontruteKandidater || []).length === 1 && !eksplisittVariantId);
    var knapp = document.createElement('button');
    knapp.type = 'button';
    knapp.className = 'sek velg-glass' + (erValgt ? ' valgt' : '');
    knapp.textContent = erValgt ? 'Valgt' : 'Velg dette glasset';
    knapp.setAttribute('aria-pressed', erValgt ? 'true' : 'false');
    knapp.addEventListener('click', function () {
      if (erValgt) return;
      velgFrontruteKandidat(kandidat);
    });
    container.append(knapp);
  }

  function renderFrontruteSporsmaal(felter) {
    var V = window.FBGView;
    var boks = $('resultat-sporsmaal');
    boks.textContent = '';
    // Spørsmålene gjelder kandidatene som fortsatt er mulige ETTER kundens svar.
    // Tidligere ble de beregnet på hele settet, så et besvart spørsmål ble stående
    // selv når bare én variant gjenstod (målt 2026-11-04: RAV4 2024 viste
    // «Har bilen oppvarmet frontrute?» på nytt etter at kunden svarte «Nei»).
    var gjenstaar = V.filtrerPaaSvar(state.frontruteKandidater || [], frontruteSvar).kandidater || [];
    var relevante = felter.filter(function (f) {
      // HUD kan ikke leses av glasset: spør bare når minst to kandidater faktisk
      // har ulik kjent verdi for feltet.
      var kjente = gjenstaar
        .map(function (k) { return (k.attributter || {})[f]; })
        .filter(function (v) { return typeof v === 'boolean'; });
      return new Set(kjente).size > 1;
    });
    var besvart = Object.keys(frontruteSvar);
    if (!relevante.length) {
      // Ingenting mer å skille: kunden skal videre til tilbud, ikke svare på nytt.
      // Har kunden svart, vises svaret med en «Endre svar»-knapp i stedet.
      if (besvart.length) {
        var wrapSvar = document.createElement('div');
        wrapSvar.className = 'sporsmaal';
        var oppsum = document.createElement('p');
        oppsum.className = 'note';
        oppsum.textContent = 'Du svarte: ' + besvart.map(function (f) {
          return V.sporsmaalstekst(f) + ' – ' + svartekstFor(f).toLowerCase();
        }).join(' · ') + '. Vi kontrollerer valget før tilbud.';
        var endre = document.createElement('button');
        endre.type = 'button';
        endre.className = 'secondary';
        endre.textContent = 'Endre svar';
        endre.addEventListener('click', function () {
          frontruteSvar = {};
          if (state.glassRequest) state.glassRequest.answers = {};
          renderFrontrute(state.glassRequest, {
            kandidater: state.frontruteKandidater,
            utfall: 'VERIFY',
            sporsmaal: felter
          }, searchGeneration);
        });
        wrapSvar.append(oppsum);
        wrapSvar.append(endre);
        boks.append(wrapSvar);
        boks.classList.remove('hidden');
      } else {
        boks.classList.add('hidden');
      }
      return;
    }
    var tittel = document.createElement('h3');
    tittel.textContent = 'Én opplysning til, så blir det riktig';
    boks.append(tittel);

    relevante.forEach(function (felt) {
      var wrap = document.createElement('div');
      wrap.className = 'sporsmaal';
      var q = document.createElement('p');
      q.textContent = V.sporsmaalstekst(felt);
      wrap.append(q);
      var hjelp = V.sporsmaalHjelp(felt);
      if (hjelp) {
        var h = document.createElement('p');
        h.className = 'muted';
        h.textContent = hjelp;
        wrap.append(h);
      }
      var rad = document.createElement('div');
      rad.className = 'svar-rad';
      V.svarAlternativer(felt).forEach(function (alt) {
        var knapp = document.createElement('button');
        knapp.type = 'button';
        knapp.className = 'secondary';
        knapp.textContent = alt.tekst;
        knapp.setAttribute('aria-pressed', frontruteSvar[felt] === alt.verdi ? 'true' : 'false');
        knapp.addEventListener('click', function () {
          frontruteSvar[felt] = alt.verdi;
          // Et nytt svar endrer grunnlaget: et tidligere eksplisitt valg kan ikke
          // lenger antas gyldig, så det nullstilles og må velges på nytt.
          eksplisittVariantId = null;
          state.glassRequest = state.glassRequest || {};
          state.glassRequest.answers = frontruteSvar;
          var data = {
            kandidater: state.frontruteKandidater,
            utfall: state.frontruteKandidater.length === 1 ? 'PINPOINT' : 'VERIFY',
            // Hele lista: renderFrontruteSporsmaal regner selv ut hvilke spørsmål
            // som fortsatt skiller de gjenstående kandidatene.
            sporsmaal: felter
          };
          renderFrontrute(state.glassRequest, data, searchGeneration);
        });
        rad.append(knapp);
      });
      wrap.append(rad);
      boks.append(wrap);
    });
    boks.classList.remove('hidden');
  }

  // 4. Rutetype: knappene bygges fra bilens data i renderGlassTyper().
  //    Her bindes bare kontrollene rundt valgflyten.

  // Ett spørsmål om gangen: «Tilbake» går til forrige reelle valg.
  $('btn-glass-back').addEventListener('click', valgTilbake);

  $('btn-glass-cancel').addEventListener('click', function () {
    searchGeneration++;
    state.currentGlassKind = null;
    state.glassRequest = null;
    valgType = null;
    valgSti = [];
    valgBak = [];

    $('glass-placement').classList.add('hidden');
    $('glass-placement-error').classList.add('hidden');

    document.querySelectorAll('.glassopt[data-type]').forEach(function (b) {
      b.classList.remove('aktiv');
      b.setAttribute('aria-pressed', 'false');
    });

    var heading = $('screen-glass').querySelector('h2');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
  });

  // «Jeg finner ikke ruten min / trenger hjelp» — egen inngang, uavhengig av
  // om katalogen har data for bilen.
  $('btn-glass-hjelp').addEventListener('click', function () {
    loggHendelse('trenger_hjelp', { merke: state.merke, modell: state.modell, aar: state.aar });
    visManuellHjelp('Jeg finner ikke ruten min');
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
    sokGlass({ kind: 'windshield' });
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
    // Release A offers an inquiry without a customer-selected product.
    var intro = document.createElement('p');
    intro.className = 'varianter-intro';
    intro.textContent = 'Vi kontrollerer riktig frontrute, pris og levering manuelt før tilbud.';
    alt.appendChild(intro);
    $('btn-inquiry').textContent = 'Be om uforpliktende tilbud';
    $('btn-inquiry').disabled = false;

    // P0.1 (Tom-doktrine): tilbehør er kandidat- og glassstyrt via
    // /api/accessories (AccessoryApplicabilityEngine som fasit).
    var tilbehorSeksjon = $('tilbehor-seksjon');
    var verifyTekst = $('tilbehor-verify');
    var montasjeValg = $('montasje-valg');
    tilbehorData = [];
    tilbehorSeksjon.classList.add('hidden');
    verifyTekst.classList.add('hidden');
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

  // Oppsummering FØR kontaktfeltene: kunden skal se hva hun ber om tilbud på.
  function oppdaterSoknadOppsummering() {
    var el = $('inquiry-oppsummering');
    var selection = state.glassRequest ? state.glassRequest.selection : null;
    var rute = glassSelectionLabel(selection);
    // SVVs handelsbetegnelse inneholder ofte merket selv («TOYOTA RAV4»).
    // Da skal merket ikke prependeres — ellers blir det «Toyota Toyota RAV4».
    var merkePent = penSkrivemaate(state.merke);
    var modellPent = penSkrivemaate(state.modell);
    var modellHarMerke = modellPent.toUpperCase().indexOf(String(state.merke || '').toUpperCase().trim()) === 0;
    var bil = [modellHarMerke ? '' : merkePent, modellPent, state.aar ? String(state.aar) : '']
      .filter(Boolean).join(' ');
    var legacy = $('inquiry-glass-summary');
    if (legacy) {
      legacy.textContent = rute || '';
      legacy.classList.toggle('hidden', !rute);
    }
    if (!el) return;
    el.textContent = '';
    var dl = document.createElement('dl');
    var rad = function (etikett, verdi) {
      if (!verdi) return;
      var dt = document.createElement('dt');
      dt.textContent = etikett;
      var dd = document.createElement('dd');
      dd.textContent = verdi;
      dl.appendChild(dt);
      dl.appendChild(dd);
    };
    rad('Bil', bil ? bil + (state.regnr ? ' · ' + state.regnr : '') : state.regnr);
    rad('Rute', rute || 'Ikke valgt — vi finner riktig rute');
    rad('Ønsket glass', valgteGlass
      ? (valgteGlass.varenavn || 'Valgt glass') + ' (' + valgteGlass.varenr + ')'
      : 'Vi foreslår riktig variant');
    rad('Må kontrolleres', 'at glasset passer bilen, pris og levering');
    if (dl.children.length) el.appendChild(dl);
  }

  // Beta-henvendelse: knapp → skjema → validering → POST → bekreftelse.
  $('btn-inquiry').addEventListener('click', function () {
    $('btn-inquiry').classList.remove('hidden');
    $('inquiry-form').classList.remove('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('inquiry-feil').classList.add('hidden');
    oppdaterSoknadOppsummering();
    $('inquiry-navn').focus();
  });

  // «Finner du ikke ruten?» — åpner forespørselen med bilen og valget beholdt.
  $('btn-resultat-hjelp').addEventListener('click', function () {
    loggHendelse('resultat_trenger_hjelp');
    $('inquiry-form').classList.remove('hidden');
    $('inquiry-bekreftet').classList.add('hidden');
    $('inquiry-feil').classList.add('hidden');
    oppdaterSoknadOppsummering();
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

  // ── P0 idempotens + tilgangsstyring (backend-kontrakt) ────────────────────
  // Backend reserverer Idempotency-Key FØR rate limit, slik at retry av SAMME
  // innhold gir replay (samme saksnummer) i stedet for en ny sak i /ops.
  // Nøkkelen fornyes ved endret innhold, etter vellykket sending og ved 409 —
  // da skal neste forsøk være en ny forespørsel, ikke en replay.
  var inquiryIdemKey = null;

  function nyInquiryNokkel() {
    inquiryIdemKey = nyClientRequestId();
    return inquiryIdemKey;
  }

  function inquiryHeaders() {
    return { 'Content-Type': 'application/json', 'Idempotency-Key': inquiryIdemKey || nyInquiryNokkel() };
  }

  // Produksjons-API-et svarer 503 når pilotstoppet er aktivt (inquiries_enabled=0),
  // og 429 ved abuse-rate-limit. 409 betyr at samme Idempotency-Key pågår eller
  // er brukt med annet innhold. Vis kundetekst i stedet for rå API-feil.
  function fortolkInquiryFeil(status, melding) {
    if (status === 503) return 'Vi tar ikke imot nye forespørsler akkurat nå. Prøv igjen senere, eller ring oss på 40 40 82 41.';
    if (status === 429) return 'For mange forespørsler fra denne nettleseren. Prøv igjen om noen minutter.';
    if (status === 409) return 'Forespørselen behandles allerede. Vent litt og prøv igjen.';
    return melding || 'Kunne ikke sende forespørselen. Prøv igjen.';
  }

  ['inquiry-navn', 'inquiry-kontakt', 'inquiry-telefon-ekstra', 'inquiry-melding', 'inquiry-kontaktpreferanse'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      // Endret innhold = ny forespørsel. Ny idempotensnøkkel, ellers ville
      // backend svart 409 KONFLIKT (samme nøkkel, annet innhold).
      inquiryIdemKey = null;
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
    var leveringsstedEl = $('inquiry-leveringssted');
    var leveringssted = leveringsstedEl ? leveringsstedEl.value.trim() : '';
    melding = 'Kontaktmåte: ' + kontaktEtikett
      + (valgteGlass ? '\nØnsket glass: ' + (valgteGlass.varenr || '') + ' ' + (valgteGlass.varenavn || '') : '')
      + (utstyrSvar.length ? '\nKundens utstyrssvar: ' + utstyrSvar.join(', ') : '')
      + (melding ? '\n' + melding : '');
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
      headers: inquiryHeaders(),
      body: JSON.stringify({
        regnr: regnr, navn: navn, kontakt: kontakt, melding: melding, sessionId: sessionId, leveringssted: leveringssted || undefined,
        contactPreference: kontaktpreferanse,
        ...(kontaktpreferanse === 'begge' ? { contactPhone: kontaktTelefon } : {}),
        ...(state.glassRequest ? { glassRequest: state.glassRequest, clientRequestId: clientRequestId } : {}),
        ...(valgteGlass && valgteGlass.variantId ? { variantId: valgteGlass.variantId } : {}),
        ...(state.merke ? { bil: { merke: state.merke, modell: state.modell, aar: state.aar } } : {})
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .then(function (r) {
        if (inquiryGeneration !== searchGeneration) return;
        if (!r.ok || !r.data.ok) { var error = new Error(r.data.error || 'Kunne ikke sende forespørselen.'); error.status = r.status; throw error; }
        inquiryIdemKey = null;
        $('inquiry-form').classList.add('hidden');
        $('btn-inquiry').disabled = true;
        $('btn-inquiry').classList.add('hidden');
        var b = $('inquiry-bekreftet');
        var bTekst = $('inquiry-bekreftet-tekst') || b;
        var id = r.data.inquiryId;
        var routeSummary = state.glassRequest ? ' Valgt rute: ' + glassSelectionLabel(state.glassRequest.selection) + '.' : '';
        var glassSummary = valgteGlass ? ' Ønsket glass: ' + (valgteGlass.varenavn || '') + '.' : '';
        var svarKanal = kontaktpreferanse === 'epost' ? 'på e-post'
          : kontaktpreferanse === 'begge' ? 'på telefon og e-post'
          : 'på telefon';
        bTekst.textContent = 'Takk, vi har mottatt forespørselen din' + (id != null ? ' (sak #' + id + ')' : '') + '.' + routeSummary + glassSummary
          + ' Vi kontrollerer bilen og glasset før vi sender deg et tilbud. Vi følger opp gjennom kontaktmåten du valgte (' + svarKanal + '). Ingen bestilling er gjennomført. Finnbilglass leverer glasset; du avtaler eventuell montering direkte med verkstedet.';
        b.className = 'svar-bekreftelse';
        b.classList.remove('hidden');
      })
      .catch(function (e) {
        if (inquiryGeneration !== searchGeneration) return;
        if (e.status === 409) inquiryIdemKey = null;
        inquiryFeil(fortolkInquiryFeil(e.status, e.message));
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
