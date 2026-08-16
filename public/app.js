/* Finnbilglass.no — frontend-flyt.
   Flyt: regnr → manuell → bekreft → glassvalg → utstyrs-spørsmål → resultat (API) → tomt.
   API: POST /api/frontrute { merke, modell, aar, profil:{sensor,antenne} }
        POST /api/regnr      { regnr }   ← ALLE kjennemerke lagres (læring).
   Mock-fallback KUN ved file:// (offline demo), tydelig merket som DEMO. */
(function () {
  'use strict';

  var state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '', vin: null, forstegangsregistrert: null, import: false, importLand: null, resolver: null };
  var spm = [
    { key: 'sensor',     tittel: 'Har bilen regnsensor?', hjelp: 'Da starter viskerne automatisk når det regner.' },
    { key: 'antenne',    tittel: 'Har bilen radioantenne i frontruten?', hjelp: 'Usikker? Velg «Vet ikke». Vi dobbeltsjekker før sending.' },
    { key: 'coated',     tittel: 'Har frontruten et sol- eller varmedempende belegg?', hjelp: 'Dette er ofte vanskelig å se. Velg «Vet ikke» hvis du er usikker.' },
    { key: 'adaskamera', tittel: 'Har bilen kamera bak speilet eller førerassistansesystemer?', hjelp: 'For eksempel filholder, nødbrems eller skiltgjenkjenning.' },
    { key: 'oppvarmet',  tittel: 'Har frontruten varmetråder i glasset?', hjelp: 'Oppvarmet frontrute har synlige tråder eller varmefelt i glasset.' }
  ];
  var spmIndex = 0;

  function $(id) { return document.getElementById(id); }

  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
    if (id === 'start') state = { merke: '', modell: '', aar: null, profil: {}, info: {}, regnr: '', vin: null, forstegangsregistrert: null, import: false, importLand: null, resolver: null };
    var el = $('screen-' + id);
    if (el) el.classList.remove('hidden');
    if (id === 'resultat') visVerify();
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
  function renderBekreftDet() {
    var det = [];
    if (state.vin) det.push('<div><b>Chassisnummer:</b> ' + state.vin + '</div>');
    var d = formatDato(state.forstegangsregistrert);
    if (d) det.push('<div><b>Førstegangsregistrert i Norge:</b> ' + d + '</div>');
    var detEl = $('bekreft-det');
    detEl.innerHTML = det.join('');
    detEl.classList.toggle('hidden', det.length === 0);
    var imp = $('bekreft-import');
    if (state.import) {
      imp.textContent = '⚠️ Dette er en importbil' + (state.importLand ? ' — importert fra ' + state.importLand : '');
      imp.classList.remove('hidden');
    } else {
      imp.classList.add('hidden');
    }
  }

  function visRegnr() {
    var t = state.regnr ? 'Kjennemerke: ' + state.regnr : '';
    ['bekreft-regnr', 'resultat-regnr'].forEach(function (id) {
      var el = $(id);
      if (el) { el.textContent = t; el.classList.toggle('hidden', !t); }
    });
  }

  // Live-formatering av kjennemerke: SU18018 → SU 18018 (norsk format: 2 bokstaver + 4–5 siffer).
  // Formateres mens kunden skriver — reduserer tastefeil og ser proft ut.
  $('input-regnr').addEventListener('input', function () {
    var v = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
    var m = /^([A-Z]{2})(\d{0,5})$/.exec(v);
    var f = m ? (m[2] ? m[1] + ' ' + m[2] : m[1]) : v;
    if (this.value !== f) this.value = f;
  });

  // 1. Start: kjennemerke → SVV-oppslag (kjennemerke → bil). ALLE kjennemerke lagres (læring).
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
      body: JSON.stringify({ regnr: raw })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        state.regnr = formatRegnr(raw);
        if (d && d.bil && d.bil.merke) {
          state.merke = d.bil.merke;
          state.modell = d.bil.modell;
          state.aar = d.bil.aar;
          state.vin = d.bil.vin || null;
          state.forstegangsregistrert = d.bil.forstegangsregistrert || null;
          state.import = !!d.bil.import;
          state.importLand = d.bil.importLand || null;
          state.resolver = d.resolver || null;
          $('bekreft-merkelbl').textContent = state.merke;
          $('bekreft-navn').textContent =
            state.modell + (state.aar ? ' · ' + state.aar : '');
          renderBekreftDet();
          show('bekreft');
        } else {
          visStartFeil('Vi fant ikke bilen på «' + formatRegnr(raw) + '». Sjekk at kjennemerket er riktig, eller ta bilde av det.');
        }
        visRegnr();
      })
      .catch(function () { visStartFeil('Noe gikk galt. Prøv igjen, eller ta bilde av kjennemerket.'); })
      .finally(function () { btn.disabled = false; btn.textContent = orgTekst; });
  });

  // 1b. Foto av kjennemerket → AI leser skiltet → SVV-oppslag (samme flyt som skrevet regnr).
  $('btn-foto-regnr').addEventListener('click', function () { $('regnr-fil').click(); });
  $('regnr-fil').addEventListener('change', function () {
    var fil = this.files && this.files[0];
    this.value = '';
    if (!fil) return;
    if (!fil.type.startsWith('image/')) { visStartFeil('Filen må være et bilde.'); return; }
    if (fil.size > 5 * 1024 * 1024) { visStartFeil('Bildet er over 5 MB — ta et nytt bilde med mobilen.'); return; }
    var leser = new FileReader();
    leser.onload = function () {
      var btn = $('btn-foto-regnr');
      var org = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = 'Leser kjennemerket…';
      fetch('/api/les-skilt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: String(leser.result) })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.funnet && d.bil && d.bil.merke) {
            state.regnr = formatRegnr(d.regnr);
            state.merke = d.bil.merke;
            state.modell = d.bil.modell;
            state.aar = d.bil.aar;
            state.vin = d.bil.vin || null;
            state.forstegangsregistrert = d.bil.forstegangsregistrert || null;
            state.import = !!d.bil.import;
            state.importLand = d.bil.importLand || null;
            state.resolver = d.resolver || null;
            $('bekreft-merkelbl').textContent = state.merke;
            $('bekreft-navn').textContent =
              state.modell + (state.aar ? ' · ' + state.aar : '');
            renderBekreftDet();
            show('bekreft');
          } else if (d && d.ok && !d.funnet) {
            visStartFeil('Vi leste «' + formatRegnr(d.regnr) + '», men fant ikke bilen i Statens vegvesen. Prøv å skrive kjennemerket manuelt.');
            $('input-regnr').value = formatRegnr(d.regnr);
          } else if (d && d.error) {
            visStartFeil(d.error);
          } else {
            visStartFeil('Kunne ikke lese kjennemerket. Prøv igjen i bedre lys, uten reflekser.');
          }
        })
        .catch(function () { visStartFeil('Noe gikk galt. Prøv igjen, eller skriv kjennemerket manuelt.'); })
        .finally(function () { btn.disabled = false; btn.innerHTML = org; });
    };
    leser.readAsDataURL(fil);
  });

  function visStartFeil(msg) {
    var el = $('start-feil');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // 3. Bekreft → videre. Logikk (aldri spør om ting som ikke skiller kandidatene):
  //    PINPOINT  → ETT entydig glass → 0 spørsmål, direkte til resultat.
  //    VERIFY    → spør KUN om funksjonene som faktisk skiller kandidatene (backend svarer).
  //    FALLBACK  → spør om sensor/antenne/coated (kan hjelpe tekstmatchen).
  $('btn-bekreft-ja').addEventListener('click', function () {
    var r = state.resolver;
    if (r && r.utfall === 'PINPOINT' && r.varenr) {
      renderResolverResultat(r.kandidater || []);
      return;
    }
    if (r && r.utfall === 'VERIFY') {
      var skillende = (r.sporsmaal && r.sporsmaal.length) ? r.sporsmaal : [];
      settSpm(skillende);
      if (!spm.length) { renderResolverResultat(r.kandidater || []); return; } // ingenting å skille på → vis varianter direkte
      spmIndex = 0;
      spmRender();
      show('spm');
      return;
    }
    settSpm(['sensor', 'antenne', 'coated']);
    spmIndex = 0;
    spmRender();
    show('spm');
  });
  $('btn-bekreft-nei').addEventListener('click', function () { show('start'); });

  // 4. Glassvalg (kun frontrute er live i beta)
  document.querySelectorAll('.glassopt').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      spmIndex = 0;
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
    if (key === 'sensor' || key === 'antenne' || key === 'coated') state.profil[key] = val;
    else state.info[key] = val; // hud / kamera / adas / oppvarmet: info i resultatet, ikke matcher-profilen
    if (spmIndex < spm.length - 1) { spmIndex++; spmRender(); return; }
    // Siste spørsmål besvart — velg direkte blant resolver-kandidatene når de finnes
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
      .then(renderResultat)
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
    var a = data && data.anbefaling;
    if (!a) {
      tomtVis('Fant ingen treff', 'Vi fant ikke noe glass for denne bilen i katalogen. Kontakt oss så hjelper vi deg manuelt.');
      return;
    }
    var st = $('resultat-status');
    if (data.pinpoint) {
      st.textContent = 'Vi har funnet en eksakt match til bilen din.';
      st.className = 'note status pinpoint';
    } else if (data && data.meta && data.meta.resolver) {
      st.textContent = 'Vi har funnet flere mulige varianter. Dette er nærmeste pris og beste kandidat akkurat nå, og vi dobbeltsjekker riktig rute for bilen din før sending.';
      st.className = 'note status verify';
    } else {
      st.textContent = 'Vi har funnet beste kandidat ut fra bildataene dine. Vi dobbeltsjekker riktig rute før sending.';
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
      var t = document.createElement('p');
      t.className = 'note';
      t.textContent = 'Andre mulige varianter:';
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

  // 6b. 43R-verifisering (valgfri) — «Vil du være 100 % sikker?»
  //     Bilde av merket på frontruten (hvitt ark bak) eller manuelt nummer.
  //     Kall /api/verify-glass → AI leser → bekreftelses-steg → bekreftet match.
  var verifyData = null;

  function visVerify() {
    var seksjon = $('verify-seksjon');
    if (!seksjon) return;
    verifyData = null;
    $('verify-bekreft').classList.add('hidden');
    $('verify-fil').value = '';
    $('verify-input').value = '';
    $('verify-status').classList.add('hidden');
    seksjon.classList.remove('hidden');
  }

  function verifyStatus(t, klasse) {
    var st = $('verify-status');
    st.textContent = t;
    st.className = 'note status ' + (klasse || '');
    st.classList.remove('hidden');
  }

  function verifySend(kilde, bildeDataUrl, r43Manuelt) {
    var body = { queryRef: 'fb-' + Date.now(), role: 'corner_marking' };
    if (bildeDataUrl) body.image = bildeDataUrl;
    if (r43Manuelt) body.r43 = r43Manuelt;
    if (state.merke && state.modell) {
      body.merke = state.merke;
      body.modell = state.modell;
      body.aar = state.aar;
      if (state.vin) body.vin = state.vin;
    }
    verifyStatus(kilde === 'photo' ? 'Leser merket…' : 'Sjekker nummeret…');
    fetch('/api/verify-glass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        verifyData = d;
        if (d.r43Nummer) {
          $('verify-lest').textContent = d.r43Nummer;
          $('verify-bekreft').classList.remove('hidden');
          $('verify-status').classList.add('hidden');
        } else {
          $('verify-bekreft').classList.add('hidden');
          verifyStatus(d.melding || 'Fant ikke 43R-nummer i bildet. Prøv igjen med bedre lys, eller skriv nummeret manuelt.');
        }
      })
      .catch(function () {
        $('verify-bekreft').classList.add('hidden');
        verifyStatus('Vi kunne ikke lese bildet akkurat nå. Prøv igjen — eller skriv nummeret manuelt.');
      });
  }

  function verifyBekreftet() {
    var d = verifyData;
    if (!d) return;
    $('verify-bekreft').classList.add('hidden');
    var f = d.fusion;
    var treff = Array.isArray(d.treff) ? d.treff : [];
    if (f && f.outcome === 'PINPOINT' && f.winner) {
      var varenr = String(f.winner.glassId).replace(/^(r43|res)-/, '');
      var rad = treff.filter(function (t) { return t.varenr === varenr; })[0] || null;
      var navn = (rad && rad.varenavn) || f.winner.label || varenr;
      var pris = (rad && rad.pris != null) ? rad.pris : (f.winner.priceTier != null ? f.winner.priceTier : null);
      verifyStatus('✅ Bekreftet: ' + navn + (pris != null ? ' — ' + formatPris(pris) : ''), 'pinpoint');
      var kort = $('resultat-kort');
      kort.querySelector('.meta').textContent = 'Varenr. ' + varenr + (rad && rad.eurokode ? ' · ' + rad.eurokode : '');
      if (pris != null) {
        $('resultat-prislbl').textContent = 'Pris inkl. mva';
        $('resultat-pris').textContent = formatPris(pris);
      }
      $('resultat-status').textContent = 'Glasset er bekreftet med 43R-nummeret fra frontruten din.';
      $('resultat-status').className = 'note status pinpoint';
    } else if (f && f.outcome === 'VERIFY') {
      verifyStatus('✅ Nummeret stemmer med riktig glassfamilie. Svar på spørsmålene over for å lande eksakt glass.', 'verify');
    } else if (treff.length) {
      var beskrivelse = treff.map(function (t) {
        return (t.varenavn || t.varenr || '') + (t.pris != null ? ' (' + formatPris(t.pris) + ')' : '');
      }).join(', ');
      verifyStatus('✅ Vi fant glasset i katalogen: ' + beskrivelse, 'pinpoint');
    } else {
      verifyStatus(d.melding || 'Vi kjenner ikke dette nummeret ennå — men glasset over er forslaget basert på bilen din.');
    }
  }

  $('btn-verify-foto').addEventListener('click', function () { $('verify-fil').click(); });
  $('verify-fil').addEventListener('change', function () {
    var fil = this.files && this.files[0];
    if (!fil) return;
    if (fil.size > 5 * 1024 * 1024) { verifyStatus('Bildet er for stort (maks 5 MB).'); return; }
    var leser = new FileReader();
    leser.onload = function () { verifySend('photo', String(leser.result)); };
    leser.readAsDataURL(fil);
  });
  $('btn-verify-sok').addEventListener('click', function () {
    var v = $('verify-input').value.trim();
    if (!/43R/i.test(v) || v.replace(/[^0-9]/g, '').length < 4) {
      verifyStatus('Skriv nummeret fra glasset, f.eks. 43R-004592.');
      return;
    }
    verifySend('manual', null, v);
  });
  $('verify-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btn-verify-sok').click(); });
  $('btn-verify-ja').addEventListener('click', verifyBekreftet);
  $('btn-verify-nei').addEventListener('click', function () {
    $('verify-bekreft').classList.add('hidden');
    $('verify-fil').value = '';
    $('verify-input').value = '';
    $('verify-status').classList.add('hidden');
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
      show(t === 'spm' ? 'start' : t); // «Nytt søk» fra resultat → start
    });
  });

  // Service worker: cache-first statisk + network-first HTML (80 % mobil = raske gjentatte besøk).
  // Kun https (aldri file://-demo). Registreres etter load for ikke å konkurrere med første maling.
  if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* ikke-kritisk */ });
    });
  }
})();
