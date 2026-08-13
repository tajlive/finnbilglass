/* Finnbilglass.no — frontend-flyt.
   Flyt: regnr → manuell → bekreft → glassvalg → utstyrs-spørsmål → resultat (API) → tomt.
   API: POST /api/frontrute { merke, modell, aar, profil:{sensor,antenne} }
        POST /api/regnr      { regnr }   ← ALLE kjennemerke lagres (læring).
   Mock-fallback KUN ved file:// (offline demo), tydelig merket som DEMO. */
(function () {
  'use strict';

  var state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '' };
  var spm = [
    { key: 'sensor',     tittel: 'Har bilen regnsensor?',       hjelp: 'Regnsensor styrer vindusviskerne automatisk.' },
    { key: 'antenne',    tittel: 'Har bilen antenne i glasset?', hjelp: 'Antenne sitter ofte i frontruten.' },
    { key: 'coated',     tittel: 'Har frontruten coating (spesialbelegg)?', hjelp: 'Coating reduserer varme og UV. Usikker? Velg «Vet ikke».' },
    { key: 'adaskamera', tittel: 'Har bilen kamera/ADAS?',       hjelp: 'Kamera/ADAS krever kalibrering etter montering.' },
    { key: 'oppvarmet',  tittel: 'Er frontruten oppvarmet?',     hjelp: 'Oppvarmet rute har varmetråder i glasset.' }
  ];
  var spmIndex = 0;

  function $(id) { return document.getElementById(id); }

  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
    if (id === 'start') state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '' };
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

  function visRegnr() {
    var t = state.regnr ? 'Kjennemerke: ' + state.regnr : '';
    ['bekreft-regnr', 'resultat-regnr'].forEach(function (id) {
      var el = $(id);
      if (el) { el.textContent = t; el.classList.toggle('hidden', !t); }
    });
  }

  // 1. Start: kjennemerke → SVV-oppslag (kjennemerke → bil). ALLE kjennemerke lagres (læring).
  //    Finner vi bilen → rett til bekreft. Finner vi den ikke → manuell innfylling.
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
      body: JSON.stringify({ regnr: raw })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        state.regnr = formatRegnr(raw);
        if (d && d.bil && d.bil.merke) {
          state.merke = d.bil.merke;
          state.modell = d.bil.modell;
          state.aar = d.bil.aar;
          $('bekreft-bil').textContent =
            state.merke + ' ' + state.modell + (state.aar ? ' · ' + state.aar : '');
          show('bekreft');
        } else {
          show('manual');
        }
        visRegnr();
      })
      .catch(function () { show('manual'); })
      .finally(function () { btn.disabled = false; btn.textContent = orgTekst; });
  });
  $('btn-manual').addEventListener('click', function () { show('manual'); });

  // 2. Manuell → bekreft
  $('form-manual').addEventListener('submit', function (e) {
    e.preventDefault();
    state.merke = $('m-merke').value.trim();
    state.modell = $('m-modell').value.trim();
    state.aar = parseInt($('m-aar').value, 10) || null;
    $('bekreft-bil').textContent =
      (state.merke ? state.merke + ' ' : '') + state.modell + (state.aar ? ' · ' + state.aar : '');
    show('bekreft');
  });

  // 3. Bekreft
  $('btn-bekreft-ja').addEventListener('click', function () { show('glass'); });
  $('btn-bekreft-nei').addEventListener('click', function () { show('manual'); });

  // 4. Glassvalg (kun frontrute er live i beta)
  document.querySelectorAll('.glassopt').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      spmIndex = 0;
      spmRender();
      show('spm');
    });
  });

  // 5. Utstyrs-spørsmål — ett om gangen, aldri anta ("Vet ikke" er alltid tilgjengelig)
  function spmRender() {
    var q = spm[spmIndex];
    $('spm-teller').textContent = (spmIndex + 1) + '/' + spm.length;
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
    if (key === 'sensor') state.profil.sensor = val;
    else if (key === 'antenne') state.profil.antenne = val;
    else if (key === 'coated') state.profil.coated = val;
    else state.info[key] = val; // adaskamera / oppvarmet: kun info i resultatet, ikke matcher-profilen
    if (spmIndex < spm.length - 1) { spmIndex++; spmRender(); }
    else { show('resultat'); lastResultat(); }
  }

  // 6. Resultat — kall Worker /api/frontrute.
  //    Mock KUN ved file:// (demo). På live: ærlig feilmelding, aldri oppdiktede treff.
  function lastResultat() {
    var body = { merke: state.merke, modell: state.modell, aar: state.aar, profil: state.profil };
    fetch('/api/frontrute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(renderResultat)
      .catch(function () {
        if (window.location.protocol === 'file:') { renderResultat(mock()); return; }
        tomtVis('Noe gikk galt', 'Vi kunne ikke hente glasset akkurat nå. Prøv igjen om litt.');
      });
  }

  function lblEgenskap(e) {
    var map = { coated: 'coating', sensor: 'regnsensor', antenne: 'antenne', solar: 'solar',
      oppvarmet: 'oppvarmet', elektrisk: 'el', innkapslet: 'innkapslet', sensorgel: 'sensorgel' };
    return map[e] || e;
  }

  function renderResultat(data) {
    visRegnr();
    var a = data && data.anbefaling;
    if (!a) {
      tomtVis('Fant ingen treff', 'Vi fant ikke noe glass for denne bilen i katalogen. Kontakt oss så hjelper vi deg manuelt.');
      return;
    }
    var st = $('resultat-status');
    if (data.pinpoint) {
      st.textContent = '✓ Dette er glasset til din bil';
      st.className = 'note status pinpoint';
    } else {
      st.textContent = 'Flere varianter passer. Vi viser den som passer best — og dobbeltsjekker mot bilens VIN før vi sender.';
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
      state.merke + ' ' + state.modell + (state.aar ? ' ' + state.aar : '');
    kort.querySelector('.meta').textContent =
      'Varenr. ' + (a.varenr || '') + (a.eurokode ? ' · ' + a.eurokode : '');

    var specs = [];
    if (state.profil.sensor === true) specs.push('med regnsensor');
    if (state.profil.sensor === false) specs.push('uten regnsensor');
    if (state.profil.antenne === true) specs.push('med antenne');
    if (state.profil.coated === true) specs.push('med coating');
    if (state.profil.coated === false) specs.push('uten coating');
    if (state.info.adaskamera === true) specs.push('kamera/ADAS');
    if (state.info.oppvarmet === true) specs.push('oppvarmet');
    kort.querySelector('.spec').textContent = specs.join(' · ');

    $('resultat-pris').textContent =
      a.pris == null ? 'Pris på forespørsel' : formatPris(a.pris);

    var alt = $('resultat-alt');
    alt.innerHTML = '';
    if (data.kandidater && data.kandidater.length > 1 && !data.pinpoint) {
      var t = document.createElement('p');
      t.className = 'note';
      t.textContent = 'Andre varianter:';
      alt.appendChild(t);
      data.kandidater.slice(1, 4).forEach(function (k) {
        var row = document.createElement('div');
        row.className = 'alt-row';
        var attrs = (k.egenskaper || []).map(lblEgenskap).join(', ');
        row.textContent = (k.varenr || '') + ' — ' + formatPris(k.pris) + (attrs ? ' · ' + attrs : '');
        alt.appendChild(row);
      });
    }
  }

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
      show(t === 'spm' ? 'start' : t); // «Nytt søk» fra resultat → start
    });
  });
})();
