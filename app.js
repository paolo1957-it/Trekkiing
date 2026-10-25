/*
 * Qui-Trekking – interfaccia: mappa, posizione, caricamento di sentieri e punti, elenco.
 * Stessa struttura di Qui-Pets e Distributori.
 */
(function () {
  "use strict";
  const cfg = window.QT_CONFIG;
  const $ = (id) => document.getElementById(id);
  const PREF = "trekking.";
  const leggiPref = (k, def) => { try { const v = localStorage.getItem(PREF + k); return v === null ? def : v; } catch (e) { return def; } };
  const salvaPref = (k, v) => { try { localStorage.setItem(PREF + k, String(v)); } catch (e) { /* ignora */ } };

  const RAGGI = [2000, 5000, 10000, 15000];
  const stato = {
    gps: null,          // ultima posizione GPS {lat, lon, acc}
    centro: null,       // punto della ricerca {lat, lon, daGps}
    raggio: +leggiPref("raggio", cfg.raggioMetri || 5000),
    categorie: null,    // Set di cosa mostrare: "D" + difficoltà per i sentieri, codice del tipo per i punti
    ordine: leggiPref("ordine", "distanza"),
    sentieri: [],       // sentieri scaricati intorno al centro
    punti: [],          // punti scaricati intorno al centro
    viciniS: [],        // sentieri entro il raggio, con distanza
    viciniP: [],        // punti entro il raggio, con distanza e apertura
    filtri: new Set(),
    caricando: false,
    seguiGps: true
  };
  if (!RAGGI.includes(stato.raggio)) stato.raggio = 5000;
  const CHIAVI_DIFF = QT.ORDINE_DIFF.map((d) => "D" + d);
  const CATEGORIE_INIZIO = cfg.categorie || CHIAVI_DIFF.concat(["R", "B", "W"]);
  {
    const scelti = leggiPref("categorie", CATEGORIE_INIZIO.join(","));
    stato.categorie = new Set(scelti.split(",").filter((k) => QT.TIPI[k] || CHIAVI_DIFF.includes(k)));
  }
  if (!["distanza", "nome", "lunghezza"].includes(stato.ordine)) stato.ordine = "distanza";

  // ---------- Mappa ----------
  const mappa = L.map("mappa", { zoomControl: false, attributionControl: true, preferCanvas: false })
    .setView([45.9, 10.5], 7);
  // Le linee dei sentieri su canvas (più veloce) con un margine di tocco largo, per prenderle col dito
  const tela = L.canvas({ padding: 0.3, tolerance: 10 });
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const OSM = 'Mappa e dati © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const sfondi = {
    topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17, subdomains: "abc",
      attribution: 'Mappa © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Dati © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }),
    stradale: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: OSM }),
    // Stessa cartina, ma ogni tessera è disegnata grande il doppio: i nomi si leggono meglio
    grande: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, tileSize: 512, zoomOffset: -1, attribution: OSM }),
    satellite: L.layerGroup([
      L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, maxNativeZoom: 19,
        attribution: "Immagini: Esri, Vantor, Earthstar Geographics, GIS User Community · Strade: Esri, HERE, Garmin · Dati © OpenStreetMap"
      }),
      L.tileLayer(ESRI + "Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: .8 }),
      L.tileLayer(ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 })
    ])
  };
  let sfondoAttivo = leggiPref("sfondo", "topo");
  if (!sfondi[sfondoAttivo]) sfondoAttivo = "topo";
  function impostaSfondo(nome) {
    Object.values(sfondi).forEach((l) => mappa.removeLayer(l));
    sfondoAttivo = sfondi[nome] ? nome : "topo";
    sfondi[sfondoAttivo].addTo(mappa);
    // la topografica arriva solo al 17: oltre si ingrandiscono le sue tessere
    mappa.setMaxZoom(19);
    $("mappa").classList.toggle("satellite", sfondoAttivo === "satellite");
    salvaPref("sfondo", sfondoAttivo);
  }
  sfondi.topo.options.maxNativeZoom = 17;
  sfondi.topo.options.maxZoom = 19;
  impostaSfondo(sfondoAttivo);

  const livelli = {
    raggio: L.layerGroup().addTo(mappa),
    sentieri: L.layerGroup().addTo(mappa),
    etichette: L.layerGroup().addTo(mappa),
    punti: L.layerGroup().addTo(mappa),
    io: L.layerGroup().addTo(mappa)
  };
  const markerPerId = new Map();
  const lineePerId = new Map();   // id sentiero → { linee: [...], bordo: [...], etichetta }
  mappa.on("dragstart", () => { stato.seguiGps = false; });
  const zoomBasso = () => $("mappa").classList.toggle("zoom-basso", mappa.getZoom() < 12);
  mappa.on("zoomend", zoomBasso);
  zoomBasso();

  // Simbolo dentro il segnaposto, uno per tipo
  const svg = (corpo, n) => `<svg viewBox="0 0 24 24" width="${n || 18}" height="${n || 18}" aria-hidden="true">${corpo}</svg>`;
  const RIFUGIO = svg('<path d="M2.5 12.5 12 4l9.5 8.5-1.5 1.6L12 7 4 14.1Z" fill="currentColor"/><path d="M5.5 13.5 12 8l6.5 5.5V21h-4.5v-5h-4v5H5.5Z" fill="currentColor"/>', 17);
  const BIVACCO = svg('<path d="M12 4 2.5 20h19Z" fill="currentColor"/><path d="M12 11l-3.2 9h6.4Z" fill="rgba(0,0,0,.35)"/>', 17);
  const GOCCIA = svg('<path d="M12 2.5C9 7 5.8 10.6 5.8 14.6a6.2 6.2 0 0 0 12.4 0C18.2 10.6 15 7 12 2.5Z" fill="currentColor"/>', 15);
  const SORGENTE = svg('<path d="M3 15c2 0 2-1.6 4.5-1.6S9.5 15 12 15s2.5-1.6 4.5-1.6S19 15 21 15M3 19.5c2 0 2-1.6 4.5-1.6s2 1.6 4.5 1.6 2.5-1.6 4.5-1.6 2.5 1.6 4.5 1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 2.5c-1.6 2.4-3.2 4.3-3.2 6.3a3.2 3.2 0 0 0 6.4 0c0-2-1.6-3.9-3.2-6.3Z" fill="currentColor"/>', 16);
  const SIMBOLO = { R: RIFUGIO, B: BIVACCO, W: GOCCIA, S: SORGENTE };
  const icona = (cls, html) => L.divIcon({ className: "", html: `<div class="mk ${cls}">${html ?? ""}</div>`, iconSize: null });
  const classiApertura = (d) => !d.apertura ? "" : d.apertura.aperto ? " aperto" : " chiuso";
  const classiMarker = (d) => `tipo-${d.k}${classiApertura(d)}`;
  const coloreDiff = (d) => getComputedStyle(document.documentElement).getPropertyValue("--d-" + d).trim() || "#8a8f99";
  const pastiglia = (d, grande) => `<span class="diff d-${d}${grande ? " grande" : ""}">${QT.DIFFICOLTA[d].sigla}</span>`;
  const simboloDi = (s) => s.sim ? QT.leggiSimbolo(s.sim) : s.cai ? QT.SIMBOLO_CAI : null;
  // segnavia col numero: quello di OSM se ha già un testo, altrimenti si scrive il numero del sentiero
  const segnavia = (s, n) => {
    const sim = simboloDi(s) || { ...QT.SIMBOLO_CAI, sfondo: "#ffffff", colore: coloreDiff(s.d), forma: "bar" };
    return QT.svgSimbolo(sim, n, sim.testo || (s.r || "").slice(0, 4));
  };

  // ---------- Utilità UI ----------
  function messaggio(testo, errore) {
    const el = $("stato");
    el.textContent = testo;
    el.classList.toggle("errore", !!errore);
    if (errore && $("pannello").hidden) toast(testo);
  }
  let timerToast;
  function toast(testo) {
    const t = $("toast");
    t.textContent = testo;
    t.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(() => { t.hidden = true; }, 3600);
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const attr = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const linkNavigazione = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  const sitoWeb = (w) => /^https?:\/\//i.test(w) ? w : "https://" + w;
  const telefoni = (t) => String(t || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  const aPiedi = (m) => "circa " + QT.formattaOre(m / 4000 * 60) + " a piedi in piano";

  // Scarica e legge il JSON entro "ms" millisecondi in tutto (risposta + dati)
  async function fetchJson(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  // ---------- Memoria sul telefono (IndexedDB): ultimi dati scaricati, quote dei sentieri, foto ----------
  const Memoria = (() => {
    let db = null;
    function apri() {
      if (db) return db;
      db = new Promise((ok, ko) => {
        if (!window.indexedDB) return ko(new Error("no idb"));
        const r = indexedDB.open("trekking", 1);
        r.onupgradeneeded = () => { ["foto", "dati", "quote"].forEach((n) => r.result.createObjectStore(n)); };
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
      db.catch(() => { db = null; });
      return db;
    }
    function op(store, modo, fn) {
      return apri().then((b) => new Promise((ok, ko) => {
        const t = b.transaction(store, modo);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => ok(r.result);
        t.onerror = () => ko(t.error);
      }));
    }
    return {
      leggi: (store, id) => op(store, "readonly", (s) => s.get(id)),
      salva: (store, id, v) => op(store, "readwrite", (s) => s.put(v, id))
    };
  })();

  // ---------- Dati ----------
  // L'app chiede a Overpass (OpenStreetMap) sentieri e punti in un riquadro un po' più largo del raggio.
  // L'ultima risposta resta sul telefono: senza campo, se copre la zona, si usa quella.
  let ultimo = null;   // { lat, lon, raggio, sentieri, punti, quando }
  const copre = (u, lat, lon, raggio) => u && QT.distanza(lat, lon, u.lat, u.lon) + raggio <= u.raggio;

  async function daOverpass(lat, lon, raggio) {
    const largo = Math.min(raggio * 1.25 + 1000, 20000);
    const query = QT.queryOverpass(QT.riquadro(lat, lon, largo), 50);
    let ultimoErrore;
    for (const url of cfg.overpass || []) {
      try {
        const dati = await fetchJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query)
        }, 60000);
        if (dati.remark && /error|runtime/i.test(dati.remark)) throw new Error(dati.remark);
        const { sentieri, punti } = QT.leggiRisposta(dati);
        return { lat, lon, raggio: largo, sentieri, punti, quando: Date.now() };
      } catch (e) {
        ultimoErrore = e;
        console.warn("Overpass", url, e);
      }
    }
    throw ultimoErrore || new Error("nessun server Overpass");
  }

  async function caricaDati(lat, lon, raggio, forza) {
    if (!forza && ultimo && Date.now() - ultimo.quando < 60 * 60000 && copre(ultimo, lat, lon, raggio)) {
      return { ...ultimo, fonte: "memoria" };
    }
    try {
      ultimo = await daOverpass(lat, lon, raggio);
      Memoria.salva("dati", "ultimo", ultimo).catch(() => {});
      return { ...ultimo, fonte: "overpass" };
    } catch (e) {
      // senza rete: gli ultimi dati salvati sul telefono, se coprono la zona
      const salvato = await Memoria.leggi("dati", "ultimo").catch(() => null);
      if (salvato && copre(salvato, lat, lon, Math.min(raggio, salvato.raggio))) {
        ultimo = salvato;
        return { ...salvato, fonte: "salvati" };
      }
      throw e;
    }
  }

  // ---------- Suoni ----------
  let audio = null;
  let suoniAttivi = leggiPref("suoni", "1") !== "0";
  function sbloccaAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== "running") audio.resume();
    } catch (e) { /* audio non disponibile */ }
  }
  document.addEventListener("pointerdown", sbloccaAudio, { passive: true });
  document.addEventListener("touchend", sbloccaAudio, { passive: true });
  // L'iPhone fa parlare l'app solo dopo che la voce è partita una volta da un tocco
  let voceSbloccata = false;
  function sbloccaVoce() {
    const s = window.speechSynthesis;
    if (voceSbloccata || !s) return;
    voceSbloccata = true;
    const u = new SpeechSynthesisUtterance(" ");
    u.lang = "it-IT";
    u.volume = 0;
    const v = vocItaliana();
    if (v) u.voice = v;
    s.speak(u);
  }
  document.addEventListener("touchend", sbloccaVoce, { passive: true });
  document.addEventListener("click", sbloccaVoce, { passive: true });
  function suona(note, volume) {
    if (!suoniAttivi || !audio || document.hidden) return;
    if (audio.state !== "running") { audio.resume().catch(() => {}); if (audio.state !== "running") return; }
    const t0 = audio.currentTime + 0.02;
    for (const [freq, inizio, durata] of note) {
      const osc = audio.createOscillator(), g = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + inizio);
      g.gain.exponentialRampToValueAtTime(volume || 0.35, t0 + inizio + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + inizio + durata);
      osc.connect(g).connect(audio.destination);
      osc.start(t0 + inizio);
      osc.stop(t0 + inizio + durata + 0.05);
    }
  }
  const SUONO = {
    aggiornato: () => suona([[1318.5, 0, 0.6], [2637, 0, 0.25]], 0.3),   // "bing"
    errore: () => suona([[392, 0, 0.25], [311, 0.22, 0.45]], 0.3)        // due note che scendono
  };

  // ---------- Caricamento ----------
  let giroCarica = 0, fonteDati = null, quandoDati = null;
  async function carica(forza, silenzioso) {
    if (!stato.centro) return;
    const giro = ++giroCarica;
    stato.caricando = true;
    $("btn-aggiorna").classList.add("gira");
    const { lat, lon } = stato.centro;
    if (!silenzioso) messaggio("Cerco sentieri, rifugi e fontanelle entro " + QT.formattaDistanza(stato.raggio) + "…");
    if (!silenzioso && !stato.sentieri.length) toast("Scarico i sentieri da OpenStreetMap…");
    let errore = null;
    try {
      const r = await caricaDati(lat, lon, stato.raggio, forza);
      if (giro !== giroCarica) return;
      stato.sentieri = r.sentieri;
      stato.punti = r.punti;
      fonteDati = r.fonte;
      quandoDati = r.quando;
      stato.tentativi = 0;
    } catch (e) {
      errore = e;
      console.warn("Dati non disponibili", e);
    }
    if (giro !== giroCarica) return;
    stato.caricando = false;
    $("btn-aggiorna").classList.remove("gira");
    ricalcola();

    clearTimeout(stato.timerRiprova);
    if (errore) {
      const attese = [30, 60, 120, 300];
      const sec = attese[Math.min(stato.tentativi || 0, attese.length - 1)];
      stato.tentativi = (stato.tentativi || 0) + 1;
      stato.timerRiprova = setTimeout(() => carica(true), sec * 1000);
      SUONO.errore();
      messaggio(`Non riesco a scaricare i dati. Riprovo da solo tra ${sec >= 60 ? sec / 60 + " min" : sec + " secondi"}.`, true);
      return;
    }
    SUONO.aggiornato();
    if ($("toast").textContent.startsWith("Scarico")) $("toast").hidden = true;
    aggiornaMessaggio();
    if (fonteDati === "salvati") toast("Niente rete: uso i dati salvati sul telefono.");
  }

  function aggiornaMessaggio() {
    const ora = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const dove = stato.centro.daGps ? "dalla tua posizione" : "dal punto cercato";
    let dati = "";
    if (quandoDati) {
      const d = new Date(quandoDati);
      const oggi = d.toDateString() === new Date().toDateString();
      dati = " · dati OpenStreetMap scaricati " + (oggi ? "alle " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
        : "il " + d.toLocaleDateString("it-IT", { day: "numeric", month: "long" }));
      if (fonteDati === "salvati") dati += " (salvati sul telefono, senza rete)";
    }
    messaggio(`Entro ${QT.formattaDistanza(stato.raggio)} ${dove}${dati} · aggiornato alle ${ora}`);
  }

  // Ricalcola distanze, aperture e filtri senza riscaricare (cambio categoria, filtri, orologio)
  function ricalcola() {
    if (!stato.centro) return;
    const { lat, lon } = stato.centro;
    stato.viciniS = QT.prepareSentieri(stato.sentieri, lat, lon, stato.raggio, stato.categorie)
      .filter((s) => !stato.filtri.has("cai") || s.cai);
    stato.viciniP = QT.preparaPunti(stato.punti, lat, lon, stato.raggio, stato.categorie)
      .filter((d) => !stato.filtri.has("aperti") || (d.apertura && d.apertura.aperto));
    render();
  }

  // ---------- Riquadri ----------
  const OPZ_POPUP = {
    get maxWidth() { return Math.min(360, window.innerWidth - 120); },
    get minWidth() { return Math.min(270, window.innerWidth - 120); },
    // le schede dei sentieri sono lunghe: oltre questa altezza scorrono
    get maxHeight() { return Math.max(260, window.innerHeight - 230); },
    autoPanPaddingTopLeft: [16, 90], autoPanPaddingBottomRight: [76, 90]
  };
  function distanzaParlata(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + " metri";
    return (m / 1000).toFixed(1).replace(".", ",") + " chilometri";
  }

  function popupPunto(d) {
    const tit = QT.titolo(d);
    const tipo = QT.nomeTipo(d);
    const voce = [tit + "."];
    const righe = [];
    if (tit.toLowerCase() !== tipo.toLowerCase()) voce.push(tipo + ".");
    const dett = [tit.toLowerCase() !== tipo.toLowerCase() ? tipo : "", d.q ? "quota " + QT.formattaQuota(+d.q) : ""].filter(Boolean).join(" · ");
    if (dett) righe.push(`<p class="pop-tipo">${esc(dett)}</p>`);
    if (d.q) voce.push("Quota " + d.q + " metri.");
    if (d.x) righe.push(`<p>${esc(d.x.charAt(0).toUpperCase() + d.x.slice(1))}</p>`);
    if (d.o) righe.push(`<p>Gestito da ${esc(d.o)}</p>`);
    if (d.p) righe.push(`<p>Posti letto: ${esc(d.p)}</p>`);
    if (d.apertura) {
      const t = QT.testoApertura(d.apertura);
      righe.push(`<p class="pop-apertura ${d.apertura.aperto ? "aperto" : "chiuso"}">${esc(t)}</p>`);
      voce.push(t.replace(" · ", ", ") + ".");
    }
    const orari = QT.orariLeggibili(d.h);
    if (orari.length) {
      righe.push(`<div class="pop-orari"><b>Orari</b>${orari.map((o) => `<span>${esc(o)}</span>`).join("")}</div>`);
      if (!d.apertura) righe.push('<p class="fonte">Orari scritti in un modo che l\'app non sa interpretare: leggili qui sopra.</p>');
    }
    if (d.k === "R") righe.push('<p class="fonte">Per mangiare o dormire telefona prima: gli orari cambiano con la stagione.</p>');
    if (d.k === "S" && !/potabile/.test(d.x || "")) righe.push('<p class="avviso">Non è indicato se l\'acqua è potabile.</p>');
    const tel = telefoni(d.t);
    if (tel.length) righe.push(`<p>Tel. ${tel.map((n) => `<a href="tel:${attr(n.replace(/[^\d+]/g, ""))}">${esc(n)}</a>`).join(" · ")}</p>`);
    if (d.w) righe.push(`<p><a href="${attr(sitoWeb(d.w))}" target="_blank" rel="noopener">Sito web</a></p>`);
    righe.push(`<p>${QT.formattaDistanza(d.distanza)} in linea d'aria</p>`);
    voce.push(distanzaParlata(d.distanza) + " in linea d'aria.");
    righe.push('<p class="fonte">Fonte: OpenStreetMap</p>');
    if (d.k === "W" || d.k === "S") righe.push(`<div class="pop-foto" data-id="${attr(d.i)}"></div>`);
    const pulsanti = [`<a class="pop-vai" href="${linkNavigazione(d.la, d.lo)}" target="_blank" rel="noopener">Portami qui</a>`];
    if (tel.length) pulsanti.push(`<a class="pop-vai pop-chiama" href="tel:${attr(tel[0].replace(/[^\d+]/g, ""))}">Chiama</a>`);
    return `<div class="pop" data-voce="${attr(voce.join(" "))}"><h3>${esc(tit)}</h3>${righe.join("")}
      <div class="pop-pulsanti">${pulsanti.join("")}</div></div>`;
  }

  // Estremità del sentiero più vicina a te (o al punto cercato): dove attaccare il sentiero
  function attacco(s) {
    const c = stato.gps || stato.centro;
    return QT.estremita(s).sort((a, b) => QT.distanza(c.lat, c.lon, a[0], a[1]) - QT.distanza(c.lat, c.lon, b[0], b[1]))[0];
  }

  function numeriSentiero(s, q) {
    const su = s.su ?? (q && q.su), giu = s.giu ?? (q && q.giu);
    const stima = s.su == null && q ? " <i>stima</i>" : "";
    const caselle = [[QT.formattaKm(s.l), "lunghezza" + (s.anello ? " (ad anello)" : "")]];
    if (su != null) caselle.push([`↗ ${su} m`, "salita" + stima], [`↘ ${giu ?? "?"} m`, "discesa" + stima]);
    else caselle.push(["…", "dislivello: calcolo"]);
    if (q && q.max != null) caselle.push([`${q.min}–${QT.formattaQuota(q.max)}`, "quota min–max"]);
    const min = s.t || (su != null ? QT.tempoStimato(s.l, su, giu) : null);
    if (min) caselle.push([QT.formattaOre(min), s.t ? "tempo indicato" : "tempo <i>stima</i>"]);
    return caselle.map(([b, t]) => `<div><b>${b}</b><span>${t}</span></div>`).join("");
  }

  function profiloSvg(q) {
    if (!q || !q.serie || q.serie.length < 3) return "";
    const v = q.serie, min = Math.min(...v), max = Math.max(...v), W = 300, H = 64;
    const x = (i) => (i / (v.length - 1)) * W, y = (h) => H - 4 - ((h - min) / Math.max(max - min, 1)) * (H - 10);
    const linea = v.map((h, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(h).toFixed(1)).join("");
    return `<svg class="profilo" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Profilo altimetrico">` +
      `<path class="area" d="${linea}L${W} ${H}L0 ${H}Z"/><path class="linea" d="${linea}"/></svg>`;
  }

  function popupSentiero(s) {
    const diff = QT.DIFFICOLTA[s.d];
    const tit = QT.titoloSentiero(s);
    const sotto = QT.sottotitoloSentiero(s);
    const q = quoteCalcolate.get(s.i);
    const voce = [tit + ".", s.r ? "Sentiero numero " + s.r + "." : "", "Difficoltà " + diff.nome + ".",
      "Lunghezza " + distanzaParlata(s.l) + ".", s.su != null ? "Salita " + s.su + " metri." : ""].filter(Boolean);
    const righe = [];
    if (sotto && sotto !== tit) righe.push(`<p class="pop-tipo">${esc(sotto)}</p>`);
    righe.push(`<div class="pop-diff">${pastiglia(s.d, true)}<span>${esc(diff.nome)}</span></div>`);
    righe.push(`<p class="pop-spiega">${esc(diff.spiega)}</p>`);
    righe.push(`<div class="pop-num" data-num="${attr(s.i)}">${numeriSentiero(s, q)}</div>`);
    righe.push(`<div class="pop-profilo" data-prof="${attr(s.i)}">${profiloSvg(q)}</div>`);
    if (s.o) righe.push(`<p>Gestito da ${esc(s.o)}</p>`);
    if (s.nota) righe.push(`<p>${esc(s.nota)}</p>`);
    righe.push(`<p>Il punto più vicino è a ${QT.formattaDistanza(s.distanza)} in linea d'aria</p>`);
    voce.push("Il punto più vicino è a " + distanzaParlata(s.distanza) + ".");
    righe.push('<p class="fonte">Fonte: OpenStreetMap' + (s.su == null ? "; quote: Copernicus DEM (Open-Meteo)" : "") + "</p>");
    const a = attacco(s);
    const pulsanti = [`<a class="pop-vai" href="${linkNavigazione(a[0], a[1])}" target="_blank" rel="noopener">Portami all'attacco</a>`];
    const link = `<a class="pop-link" href="https://hiking.waymarkedtrails.org/#route?id=${attr(s.i.slice(1))}" target="_blank" rel="noopener">Profilo e dettagli su Waymarked Trails</a>`;
    const testa = `<div class="pop-testa">${segnavia(s, 30)}<h3>${esc(tit)}</h3></div>`;
    return `<div class="pop pop-sentiero" data-voce="${attr(voce.join(" "))}" data-sentiero="${attr(s.i)}">${testa}${righe.join("")}
      <div class="pop-pulsanti">${pulsanti.join("")}</div>${link}</div>`;
  }

  // ---------- Dislivello dalle quote del terreno ----------
  // Quando OpenStreetMap non ha salita e discesa, si chiedono a Open-Meteo le quote di 100 punti lungo il sentiero.
  const quoteCalcolate = new Map();
  async function calcolaQuote(s) {
    if (quoteCalcolate.has(s.i)) return quoteCalcolate.get(s.i);
    const salvate = await Memoria.leggi("quote", s.i).catch(() => null);
    if (salvate && salvate.l === s.l) { quoteCalcolate.set(s.i, salvate); return salvate; }
    const c = QT.campioni(s, 100);
    if (c.length < 2) return null;
    const url = cfg.quote + "?latitude=" + c.map((p) => p.la.toFixed(5)).join(",") + "&longitude=" + c.map((p) => p.lo.toFixed(5)).join(",");
    const r = await fetchJson(url, {}, 15000);
    const quote = r.elevation || [];
    const d = QT.dislivello(quote, c.map((p) => p.tratto));
    if (!d) return null;
    // per il disegno del profilo si usa solo il tratto più lungo (il primo)
    d.serie = quote.filter((h, i) => c[i].tratto === 0 && isFinite(h)).map((h) => Math.round(h));
    d.l = s.l;
    quoteCalcolate.set(s.i, d);
    Memoria.salva("quote", s.i, d).catch(() => {});
    return d;
  }
  function riempiQuote(el, s, popup) {
    const scrivi = (q) => {
      const num = el.querySelector(`[data-num="${CSS.escape(s.i)}"]`);
      if (num) num.innerHTML = numeriSentiero(s, q);
      const prof = el.querySelector(`[data-prof="${CSS.escape(s.i)}"]`);
      if (prof) prof.innerHTML = profiloSvg(q);
      if (popup && popup.isOpen()) { popup._updateLayout(); popup._updatePosition(); }
    };
    calcolaQuote(s).then((q) => scrivi(q || null)).catch(() => {
      const num = el.querySelector(`[data-num="${CSS.escape(s.i)}"]`);
      if (num && s.su == null) num.innerHTML = numeriSentiero(s, null).replace("dislivello: calcolo", "dislivello non disponibile").replace("<b>…</b>", "<b>–</b>");
    });
  }

  // ---------- Foto delle fontanelle e sorgenti ----------
  // Il sito non ha un server: la foto resta nel telefono (IndexedDB), ridotta per non occupare spazio.
  function riduciFoto(file) {
    return new Promise((ok, ko) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 1280, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * sc);
        c.height = Math.round(img.naturalHeight * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? ok(b) : ko(new Error("foto"))), "image/jpeg", 0.75);
      };
      img.onerror = () => { URL.revokeObjectURL(url); ko(new Error("foto")); };
      img.src = url;
    });
  }

  let urlFoto = null;
  function mostraFoto(box, popup) {
    const id = box.dataset.id;
    const ridisegna = () => {
      if (!popup || !popup.isOpen()) return;
      popup._updateLayout(); popup._updatePosition(); popup._adjustPan();
    };
    Memoria.leggi("foto", id).then((blob) => {
      if (!box.isConnected) return;
      if (urlFoto) { URL.revokeObjectURL(urlFoto); urlFoto = null; }
      if (blob) {
        urlFoto = URL.createObjectURL(blob);
        box.innerHTML = `<img src="${urlFoto}" alt="La tua foto">
          <div class="pop-foto-azioni"><button type="button" class="pop-rifai">Rifai la foto</button></div>
          <input type="file" accept="image/*" capture="environment" class="pop-file" tabindex="-1" aria-hidden="true">`;
        box.querySelector("img").addEventListener("load", ridisegna);
      } else {
        box.innerHTML = `<button type="button" class="pop-scatta">📷 Scatta una foto</button>
          <input type="file" accept="image/*" capture="environment" class="pop-file" tabindex="-1" aria-hidden="true">`;
      }
      const file = box.querySelector(".pop-file");
      box.querySelector(".pop-scatta, .pop-rifai").addEventListener("click", () => file.click());
      file.addEventListener("change", () => {
        const f = file.files && file.files[0];
        if (!f) return;
        box.innerHTML = '<p class="fonte">Salvo la foto…</p>';
        riduciFoto(f).then((b) => Memoria.salva("foto", id, b))
          .then(() => {
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
            mostraFoto(box, popup);
          })
          .catch(() => { toast("Non sono riuscito a salvare la foto."); mostraFoto(box, popup); });
      });
      ridisegna();
    }).catch(() => { box.hidden = true; });
  }

  // ---------- Sentiero evidenziato ----------
  let evidenziato = null;
  function evidenzia(id) {
    if (evidenziato === id) return;
    evidenziato = id;
    for (const [k, v] of lineePerId) {
      const su = k === id;
      const opaco = id && !su;
      v.linee.forEach((l) => l.setStyle({ weight: su ? 7 : 4.5, opacity: opaco ? .35 : 1 }));
      v.bordo.forEach((l) => l.setStyle({ weight: su ? 11 : 7.5, opacity: opaco ? .2 : .85 }));
      if (su) { v.bordo.forEach((l) => l.bringToFront()); v.linee.forEach((l) => l.bringToFront()); }
    }
  }

  mappa.on("popupopen", (e) => {
    const el = e.popup.getElement && e.popup.getElement();
    if (!el) return;
    const box = el.querySelector(".pop-foto");
    if (box) mostraFoto(box, e.popup);
    const ps = el.querySelector("[data-sentiero]");
    if (ps) {
      const s = stato.viciniS.find((x) => x.i === ps.dataset.sentiero) || stato.sentieri.find((x) => x.i === ps.dataset.sentiero);
      evidenzia(ps.dataset.sentiero);
      if (s && (s.su == null || !quoteCalcolate.has(s.i))) riempiQuote(el, s, e.popup);
    }
  });
  mappa.on("popupclose", () => evidenzia(null));

  // ---------- Rendering ----------
  // Ordine sulla mappa: rifugi sopra, poi bivacchi, poi l'acqua; gli aperti sopra i chiusi
  const PESO = { R: 900, B: 700, W: 500, S: 300 };

  function render() {
    livelli.raggio.clearLayers();
    livelli.sentieri.clearLayers();
    livelli.etichette.clearLayers();
    livelli.punti.clearLayers();
    markerPerId.clear();
    lineePerId.clear();
    evidenziato = null;
    if (!stato.centro) return;
    const { lat, lon } = stato.centro;

    L.circle([lat, lon], {
      radius: stato.raggio, color: getComputedStyle(document.documentElement).getPropertyValue("--blu").trim() || "#2f6b2a",
      weight: 1.5, opacity: .6, fillOpacity: .03, dashArray: "6 6", interactive: false
    }).addTo(livelli.raggio);
    if (!stato.centro.daGps) {
      L.circleMarker([lat, lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#172033", fillOpacity: 1 }).addTo(livelli.raggio);
    }

    // Sentieri: prima i facili, così i difficili restano sopra
    const ordineDiff = (s) => QT.ORDINE_DIFF.indexOf(s.d === "ND" ? "T" : s.d);
    const sentieri = stato.viciniS.slice().sort((a, b) => ordineDiff(a) - ordineDiff(b));
    for (const s of sentieri) {
      const colore = coloreDiff(s.d);
      const apri = (e) => {
        L.popup(OPZ_POPUP).setLatLng(e && e.latlng ? e.latlng : s.vicino).setContent(() => popupSentiero(s)).openOn(mappa);
      };
      const bordo = s.g.map((l) => L.polyline(l, { renderer: tela, color: "#ffffff", weight: 7.5, opacity: .85, interactive: false }).addTo(livelli.sentieri));
      const linee = s.g.map((l) => L.polyline(l, {
        renderer: tela, color: colore, weight: 4.5, opacity: 1, lineCap: "round", lineJoin: "round",
        dashArray: s.d === "EEA" ? "10 6" : s.d === "ND" ? "2 7" : null
      }).on("click", apri).addTo(livelli.sentieri));
      // segnavia col numero a metà del tratto più lungo
      let etichetta = null;
      if (s.r || s.sim) {
        const l = s.g[0];
        const m = l[Math.floor(l.length / 2)];
        etichetta = L.marker(m, {
          icon: L.divIcon({ className: "", html: `<div class="lbl-sentiero">${segnavia(s, 22)}</div>`, iconSize: null, iconAnchor: [14, 11] }),
          title: QT.titoloSentiero(s), zIndexOffset: -500
        }).on("click", () => apri({ latlng: L.latLng(m[0], m[1]) })).addTo(livelli.etichette);
      }
      lineePerId.set(s.i, { linee, bordo, etichetta, apri });
    }

    const daMostrare = stato.viciniP.slice().sort((a, b) => a.distanza - b.distanza).slice(0, cfg.maxSegnaposto || 800);
    for (const d of daMostrare) {
      const z = (PESO[d.k] || 0) + (d.apertura && !d.apertura.aperto ? -100 : 0);
      const m = L.marker([d.la, d.lo], { icon: icona(classiMarker(d), SIMBOLO[d.k]), title: QT.titolo(d), zIndexOffset: z })
        .bindPopup(() => popupPunto(d), OPZ_POPUP).addTo(livelli.punti);
      markerPerId.set(d.i, m);
    }
    if (stato.viciniP.length > daMostrare.length) {
      toast(`Sulla mappa i ${daMostrare.length} punti più vicini su ${stato.viciniP.length}: togli qualche tipo o riduci il raggio.`);
    }

    const tuttiP = QT.preparaPunti(stato.punti, lat, lon, stato.raggio, null);
    const acqua = tuttiP.filter((d) => d.k === "W").sort((a, b) => a.distanza - b.distanza)[0];
    $("k-n").textContent = stato.viciniS.length;
    $("k-rif").textContent = tuttiP.filter((d) => d.k === "R" || d.k === "B").length;
    $("k-acqua").textContent = acqua ? QT.formattaDistanza(acqua.distanza) : "–";
    const n = stato.viciniS.length + stato.viciniP.length;
    const badge = $("badge-elenco");
    badge.hidden = !n;
    badge.textContent = n > 999 ? "999+" : n;

    renderLista();
  }

  function voceSentiero(s) {
    const li = document.createElement("li");
    li.className = "voce";
    li.tabIndex = 0;
    const meta = [pastiglia(s.d), `<span>${QT.formattaKm(s.l)}</span>`];
    if (s.su != null) meta.push(`<span>↗ ${s.su} m</span>`);
    const sotto = QT.sottotitoloSentiero(s);
    if (sotto && sotto !== QT.titoloSentiero(s)) meta.push(`<span>${esc(sotto)}</span>`);
    li.innerHTML = `
      <div class="icona-tipo">${segnavia(s, 26)}</div>
      <div class="voce-testo">
        <div class="voce-titolo">${esc(QT.titoloSentiero(s))}</div>
        <div class="voce-meta">${meta.join("")}</div>
      </div>
      <div class="voce-dist"><b>${QT.formattaDistanza(s.distanza)}</b><small>il punto più vicino</small></div>`;
    const apri = () => { mostraSentiero(s); chiudiElenco(); };
    li.addEventListener("click", apri);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apri(); } });
    return li;
  }

  function vocePunto(d) {
    const li = document.createElement("li");
    li.className = "voce";
    li.tabIndex = 0;
    const meta = [];
    if (QT.titolo(d) !== QT.nomeTipo(d)) meta.push(`<span>${esc(QT.nomeTipo(d))}</span>`);
    if (d.q) meta.push(`<span>${QT.formattaQuota(+d.q)}</span>`);
    if (d.x) meta.push(`<span>${esc(d.x)}</span>`);
    if (d.apertura) meta.push(`<span class="tag ${d.apertura.aperto ? "aperto" : "chiuso"}">${esc(QT.testoApertura(d.apertura))}</span>`);
    li.innerHTML = `
      <div class="icona-tipo"><span class="mk ${classiMarker(d)}">${SIMBOLO[d.k]}</span></div>
      <div class="voce-testo">
        <div class="voce-titolo">${esc(QT.titolo(d))}</div>
        <div class="voce-meta">${meta.join("")}</div>
      </div>
      <div class="voce-dist"><b>${QT.formattaDistanza(d.distanza)}</b><small>in linea d'aria</small></div>`;
    const apri = () => { mostra(d); chiudiElenco(); };
    li.addEventListener("click", apri);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apri(); } });
    return li;
  }

  function renderLista() {
    const ol = $("lista");
    ol.innerHTML = "";
    const nome = (x) => x.g ? QT.titoloSentiero(x) : QT.titolo(x);
    const lista = [...stato.viciniS, ...stato.viciniP].sort((a, b) => {
      if (stato.ordine === "nome") return nome(a).localeCompare(nome(b), "it", { numeric: true }) || a.distanza - b.distanza;
      if (stato.ordine === "lunghezza") return (a.g ? 0 : 1) - (b.g ? 0 : 1) || (a.l || 0) - (b.l || 0) || a.distanza - b.distanza;
      return a.distanza - b.distanza;
    });
    if (!lista.length) {
      const li = document.createElement("li");
      li.className = "vuoto";
      li.textContent = stato.caricando ? "Scarico i dati…" : stato.filtri.size
        ? "Niente con questi filtri. Prova a toglierne uno o ad allargare il raggio."
        : "Nessun sentiero o punto scelto in questo raggio. Prova ad allargarlo o a scegliere altro in “Cosa mostrare”.";
      ol.appendChild(li);
      return;
    }
    lista.slice(0, 250).forEach((x) => ol.appendChild(x.g ? voceSentiero(x) : vocePunto(x)));
  }

  function mostra(d) {
    if (!d) return;
    stato.seguiGps = false;
    mappa.setView([d.la, d.lo], Math.max(mappa.getZoom(), 15));
    let m = markerPerId.get(d.i);
    if (!m) {
      // fuori dai tipi scelti: segnaposto temporaneo
      m = L.marker([d.la, d.lo], { icon: icona(classiMarker(d), SIMBOLO[d.k]), zIndexOffset: 2000 })
        .bindPopup(() => popupPunto(d), OPZ_POPUP).addTo(livelli.punti);
      markerPerId.set(d.i, m);
    }
    setTimeout(() => m.openPopup(), 250);
  }

  function mostraSentiero(s) {
    stato.seguiGps = false;
    const limiti = L.latLngBounds(s.g.flat());
    mappa.fitBounds(limiti, { paddingTopLeft: [20, 80], paddingBottomRight: [80, 120], maxZoom: 16 });
    const v = lineePerId.get(s.i);
    setTimeout(() => {
      if (v) v.apri({ latlng: L.latLng(s.vicino[0], s.vicino[1]) });
      else L.popup(OPZ_POPUP).setLatLng(s.vicino).setContent(() => popupSentiero(s)).openOn(mappa);
    }, 350);
  }

  // ---------- Posizione ----------
  let marcatoreIo, cerchioPrecisione;

  function impostaCentro(lat, lon, daGps) {
    const prima = stato.centro;
    stato.centro = { lat, lon, daGps };
    const spostato = !prima || prima.daGps !== daGps ||
      QT.distanza(prima.lat, prima.lon, lat, lon) > (cfg.ricaricaDopoMetri || 500);
    if (spostato) {
      mappa.fitBounds(L.latLng(lat, lon).toBounds(stato.raggio * 2.1));
      carica();
    }
  }

  function suPosizione(p) {
    const { latitude: lat, longitude: lon, accuracy: acc } = p.coords;
    stato.gps = { lat, lon, acc };
    if (!marcatoreIo) {
      marcatoreIo = L.marker([lat, lon], { icon: L.divIcon({ className: "", html: '<div class="io"></div>', iconSize: [18, 18] }), zIndexOffset: 3000, interactive: false }).addTo(livelli.io);
      cerchioPrecisione = L.circle([lat, lon], { radius: acc, color: "#2f7cf6", weight: 0, fillOpacity: .12, interactive: false }).addTo(livelli.io);
    } else {
      marcatoreIo.setLatLng([lat, lon]);
      cerchioPrecisione.setLatLng([lat, lon]).setRadius(acc);
    }
    if (stato.seguiGps) impostaCentro(lat, lon, true);
  }

  function erroreGps(e) {
    const testi = {
      1: "Posizione non autorizzata. Consenti l'accesso alla posizione oppure cerca un luogo.",
      2: "Posizione non disponibile. Cerca un luogo qui sopra.",
      3: "Il GPS non risponde. Cerca un luogo qui sopra."
    };
    if (!stato.gps) messaggio(testi[e.code] || testi[2], true);
  }

  function avviaGps() {
    if (!("geolocation" in navigator)) {
      messaggio("Questo browser non fornisce la posizione. Cerca un luogo qui sopra.", true);
      return;
    }
    if (!window.isSecureContext) {
      messaggio("Il GPS funziona solo su HTTPS. Pubblica l'app su un sito https o cerca un luogo.", true);
    }
    navigator.geolocation.watchPosition(suPosizione, erroreGps, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }

  // ---------- Ricerca luogo ----------
  $("form-cerca").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("cerca-indirizzo").value.trim();
    if (!q) return;
    messaggio("Cerco “" + q + "”…");
    try {
      const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=it,ch,fr,at,si,sm,va&accept-language=it&q=" + encodeURIComponent(q);
      const [primo] = await fetchJson(url, { headers: { Accept: "application/json" } }, 12000);
      if (!primo) { messaggio("Luogo non trovato. Prova ad aggiungere il comune o la provincia.", true); return; }
      stato.seguiGps = false;
      $("cerca-indirizzo").blur();
      impostaCentro(+primo.lat, +primo.lon, false);
    } catch (err) {
      messaggio("Ricerca non riuscita. Controlla la connessione.", true);
    }
  });

  // ---------- Controlli ----------
  $("btn-centra").addEventListener("click", () => {
    stato.seguiGps = true;
    if (stato.gps) {
      impostaCentro(stato.gps.lat, stato.gps.lon, true);
      mappa.fitBounds(L.latLng(stato.gps.lat, stato.gps.lon).toBounds(stato.raggio * 2.1));
    } else toast("Posizione non ancora disponibile.");
  });
  $("btn-aggiorna").addEventListener("click", () => carica(true));
  // I pulsanti in basso cercano tra tutti i punti nel raggio, qualunque cosa sia scelta in alto
  const tuttiNelRaggio = () => stato.centro ? QT.preparaPunti(stato.punti, stato.centro.lat, stato.centro.lon, stato.raggio, null) : [];
  $("btn-rifugio").addEventListener("click", () => {
    const rif = tuttiNelRaggio().filter((x) => x.k === "R").sort((a, b) => a.distanza - b.distanza);
    const aperto = rif.find((x) => x.apertura && x.apertura.aperto);
    if (aperto) { mostra(aperto); return; }
    if (rif[0]) { mostra(rif[0]); if (rif.some((x) => x.apertura)) toast("Nessun rifugio risulta aperto adesso: ecco il più vicino. Telefona prima."); return; }
    const biv = tuttiNelRaggio().filter((x) => x.k === "B").sort((a, b) => a.distanza - b.distanza)[0];
    if (biv) { mostra(biv); toast("Nessun rifugio nel raggio: ecco il bivacco più vicino."); return; }
    toast(`Nessun rifugio entro ${QT.formattaDistanza(stato.raggio)}: allarga il raggio.`);
  });
  $("btn-acqua").addEventListener("click", () => {
    const tutti = tuttiNelRaggio();
    const d = tutti.filter((x) => x.k === "W" && !/non potabile/.test(x.x || "")).sort((a, b) => a.distanza - b.distanza)[0];
    if (d) { mostra(d); return; }
    const s = tutti.filter((x) => x.k === "S").sort((a, b) => a.distanza - b.distanza)[0];
    if (s) { mostra(s); toast("Nessuna fontanella nel raggio: ecco la sorgente più vicina. Non è detto che sia potabile."); return; }
    toast(`Nessuna fontanella entro ${QT.formattaDistanza(stato.raggio)}: allarga il raggio.`);
  });

  $("raggio").value = String(stato.raggio);
  $("raggio").addEventListener("change", (e) => {
    stato.raggio = +e.target.value;
    salvaPref("raggio", stato.raggio);
    if (stato.centro) {
      mappa.fitBounds(L.latLng(stato.centro.lat, stato.centro.lon).toBounds(stato.raggio * 2.1));
      carica();
    }
  });

  // Cosa mostrare: caselle per le difficoltà dei sentieri e per i tipi di punti; la mappa cambia subito
  const BREVE = { R: "Rifugi", B: "Bivacchi", W: "Fontanelle", S: "Sorgenti" };
  $("cat-sentieri").innerHTML = QT.ORDINE_DIFF.map((d) =>
    `<label class="cat-voce"><input type="checkbox" value="D${d}"${stato.categorie.has("D" + d) ? " checked" : ""}>` +
    `${pastiglia(d)}<span>${esc(QT.DIFFICOLTA[d].nome)}</span></label>`).join("");
  $("cat-voci").innerHTML = Object.entries(QT.TIPI).map(([k, t]) =>
    `<label class="cat-voce"><input type="checkbox" value="${k}"${stato.categorie.has(k) ? " checked" : ""}>` +
    `<span class="mk tipo-${k}">${SIMBOLO[k]}</span><span>${esc(t.plurale)}</span></label>`).join("");
  function scriviCategorie() {
    const diff = CHIAVI_DIFF.filter((k) => stato.categorie.has(k));
    const punti = Object.keys(QT.TIPI).filter((k) => stato.categorie.has(k));
    const parti = [];
    if (diff.length === CHIAVI_DIFF.length) parti.push(punti.length ? "Sentieri +" + punti.length : "Sentieri");
    else if (diff.length) parti.push(diff.map((k) => QT.DIFFICOLTA[k.slice(1)].sigla).join(" "));
    if (diff.length === CHIAVI_DIFF.length && punti.length) { /* già scritto */ }
    else if (punti.length === 1) parti.push(BREVE[punti[0]]);
    else if (punti.length) parti.push(punti.length + " punti");
    $("categoria-testo").textContent = parti.length ? parti.join(" + ") : "Nessuno";
  }
  scriviCategorie();
  function cambiaCategoria(e) {
    const k = e.target.value;
    if (e.target.checked) stato.categorie.add(k); else stato.categorie.delete(k);
    salvaPref("categorie", [...stato.categorie].join(","));
    scriviCategorie();
    mappa.closePopup();
    ricalcola();
  }
  $("cat-sentieri").addEventListener("change", cambiaCategoria);
  $("cat-voci").addEventListener("change", cambiaCategoria);
  function apriCategorie(apri) {
    $("cat-menu").hidden = !apri;
    $("categoria").setAttribute("aria-expanded", String(apri));
    if (!apri && !stato.categorie.size) toast("Niente di scelto: la mappa resta vuota");
  }
  $("categoria").addEventListener("click", () => apriCategorie($("cat-menu").hidden));
  $("cat-ok").addEventListener("click", () => { apriCategorie(false); $("categoria").focus(); });
  document.addEventListener("pointerdown", (e) => {
    if (!$("cat-menu").hidden && !$("cat-box").contains(e.target)) apriCategorie(false);
  });
  function aggiornaChipOrdine() {
    document.querySelectorAll(".chip.ordine").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.ordine === stato.ordine)));
  }
  aggiornaChipOrdine();
  document.querySelectorAll(".chip.ordine").forEach((c) => c.addEventListener("click", () => {
    stato.ordine = c.dataset.ordine;
    salvaPref("ordine", stato.ordine);
    aggiornaChipOrdine();
    renderLista();
  }));
  document.querySelectorAll(".chip.filtro").forEach((c) => c.addEventListener("click", () => {
    const f = c.dataset.filtro;
    const on = !stato.filtri.has(f);
    on ? stato.filtri.add(f) : stato.filtri.delete(f);
    c.setAttribute("aria-pressed", String(on));
    ricalcola();
  }));
  function apriElenco() {
    $("pannello").hidden = false;
    $("btn-elenco").setAttribute("aria-expanded", "true");
    $("btn-chiudi").focus();
  }
  function chiudiElenco() {
    if ($("pannello").hidden) return;
    $("pannello").hidden = true;
    $("btn-elenco").setAttribute("aria-expanded", "false");
    $("btn-elenco").focus();
  }
  $("btn-elenco").addEventListener("click", apriElenco);
  $("btn-chiudi").addEventListener("click", chiudiElenco);

  // ---------- Guida ----------
  $("g-diff").innerHTML = QT.ORDINE_DIFF.map((d) =>
    `<li><span class="g-segno">${pastiglia(d, true)}</span><div><b>${esc(QT.DIFFICOLTA[d].nome)}</b>: ${esc(QT.DIFFICOLTA[d].spiega.charAt(0).toLowerCase() + QT.DIFFICOLTA[d].spiega.slice(1))}` +
    (d === "EEA" ? " Sulla mappa la linea è tratteggiata." : d === "ND" ? " Sulla mappa la linea è a puntini." : "") + `</div></li>`).join("") +
    `<li><span class="g-segno">${QT.svgSimbolo(QT.SIMBOLO_CAI, 28, "123")}</span><div><b>Segnavia</b>: il simbolo dipinto lungo il sentiero, con il suo numero. Quello bianco e rosso è il segnavia del CAI.</div></li>`;
  $("g-legenda").innerHTML = Object.entries(QT.TIPI).map(([k, t]) =>
    `<li><span class="g-segno"><span class="mk tipo-${k}">${SIMBOLO[k]}</span></span><div><b>${esc(t.nome)}</b>${{
      R: ": rifugio custodito, dove mangiare e dormire nella stagione di apertura.",
      B: ": bivacco o ricovero sempre aperto, senza gestore: riparo d'emergenza.",
      W: ": fontanella di acqua potabile.",
      S: ": sorgente naturale. Si vedono solo scegliendo “Sorgenti” nel menu: l'acqua spesso non è controllata."
    }[k] || "."}</div></li>`).join("");

  let tornaA = null;
  function apriGuida(e) {
    tornaA = e && e.currentTarget ? e.currentTarget : $("btn-guida");
    $("guida").hidden = false;
    $("guida").querySelector(".pannello-corpo").scrollTop = 0;
    $("btn-guida").setAttribute("aria-expanded", "true");
    $("btn-chiudi-guida").focus();
  }
  function chiudiGuida() {
    if ($("guida").hidden) return false;
    $("guida").hidden = true;
    $("btn-guida").setAttribute("aria-expanded", "false");
    if (tornaA && tornaA.offsetParent) tornaA.focus();
    return true;
  }
  $("btn-guida").addEventListener("click", apriGuida);
  $("btn-chiudi-guida").addEventListener("click", chiudiGuida);
  $("guida").querySelectorAll(".g-indice a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const dest = $("guida").querySelector(a.getAttribute("href"));
    if (dest) dest.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  $("guida-versione").textContent = "Versione " + (cfg.versione || "");
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("cat-menu").hidden) { apriCategorie(false); $("categoria").focus(); return; }
    if (!chiudiGuida()) chiudiElenco();
  });

  // ---------- Lettura vocale dei riquadri ----------
  let letturaAttiva = leggiPref("lettura", "1") !== "0";
  const sintesi = window.speechSynthesis;
  function vocItaliana() {
    const voci = sintesi ? sintesi.getVoices() : [];
    return voci.find((v) => /^it[-_]IT/i.test(v.lang) && v.localService) || voci.find((v) => /^it/i.test(v.lang)) || null;
  }
  function leggi(testo) {
    if (!sintesi || !testo) return;
    sintesi.cancel();
    const u = new SpeechSynthesisUtterance(testo);
    u.lang = "it-IT";
    const v = vocItaliana();
    if (v) u.voice = v;
    u.rate = 1;
    sintesi.speak(u);
  }
  mappa.on("popupopen", (e) => {
    if (!letturaAttiva) return;
    const el = e.popup.getElement && e.popup.getElement();
    const pop = el ? el.querySelector(".pop") : null;
    if (pop) leggi(pop.dataset.voce);
  });
  mappa.on("popupclose", () => { if (sintesi) sintesi.cancel(); });
  if (!sintesi) { $("riga-lettura").hidden = true; }
  $("lettura").value = letturaAttiva ? "1" : "0";
  $("lettura").addEventListener("change", (e) => {
    letturaAttiva = e.target.value === "1";
    salvaPref("lettura", letturaAttiva ? "1" : "0");
    if (letturaAttiva) leggi("Lettura vocale attiva.");
    else if (sintesi) sintesi.cancel();
  });

  // ---------- Auto-refresh ----------
  // Ogni N secondi torna sulla tua posizione e ricalcola sentieri e punti vicini (riscarica solo se ti sei spostato molto).
  let timerAuto;
  function autoAggiorna() {
    if (document.hidden || !stato.gps) return;
    stato.seguiGps = true;
    stato.centro = { lat: stato.gps.lat, lon: stato.gps.lon, daGps: true };
    if (!mappa._popup) mappa.setView([stato.gps.lat, stato.gps.lon], Math.max(mappa.getZoom(), 13));
    carica(false, true);
  }
  function impostaAuto(sec) {
    clearInterval(timerAuto);
    if (sec > 0) timerAuto = setInterval(autoAggiorna, sec * 1000);
    autoAttivo = sec > 0;
    aggiornaSchermoAcceso();
    salvaPref("auto", sec);
  }

  // ---------- Schermo sempre acceso (Wake Lock) ----------
  let autoAttivo = false, bloccoSchermo = null, richiestaInCorso = false;
  function mostraOcchio() { $("occhio").hidden = !bloccoSchermo; }
  async function aggiornaSchermoAcceso() {
    const vuole = autoAttivo && document.visibilityState === "visible";
    if (!vuole) {
      if (bloccoSchermo) { const b = bloccoSchermo; bloccoSchermo = null; b.release().catch(() => {}); }
      mostraOcchio();
      return;
    }
    if (bloccoSchermo || richiestaInCorso || !("wakeLock" in navigator)) { mostraOcchio(); return; }
    richiestaInCorso = true;
    try {
      const b = await navigator.wakeLock.request("screen");
      b.addEventListener("release", () => { if (bloccoSchermo === b) { bloccoSchermo = null; mostraOcchio(); } });
      if (autoAttivo && document.visibilityState === "visible") bloccoSchermo = b;
      else b.release().catch(() => {});
    } catch (e) { /* non supportato o negato: l'app funziona lo stesso */ }
    richiestaInCorso = false;
    mostraOcchio();
  }
  document.addEventListener("visibilitychange", aggiornaSchermoAcceso);
  document.addEventListener("pointerdown", () => { if (autoAttivo && !bloccoSchermo) aggiornaSchermoAcceso(); }, { passive: true });

  let secAuto = cfg.autoRefreshSecondi ?? 0;
  const salvato = leggiPref("auto", null);
  if (salvato !== null && ["0", "30", "60", "120"].includes(salvato)) secAuto = +salvato;
  $("auto-refresh").value = String(secAuto);
  impostaAuto(secAuto);
  $("auto-refresh").addEventListener("change", (e) => {
    impostaAuto(+e.target.value);
    toast(+e.target.value ? `Auto-refresh ogni ${e.target.value} secondi` : "Auto-refresh disattivato");
  });
  $("sfondo").value = sfondoAttivo;
  $("sfondo").addEventListener("change", (e) => impostaSfondo(e.target.value));
  $("suoni").value = suoniAttivi ? "1" : "0";
  $("suoni").addEventListener("change", (e) => {
    suoniAttivi = e.target.value === "1";
    salvaPref("suoni", suoniAttivi ? "1" : "0");
    sbloccaAudio();
    if (suoniAttivi) setTimeout(SUONO.aggiornato, 150); // prova
  });

  // Ogni minuto ricalcola chi è aperto (se non stai guardando un riquadro)
  setInterval(() => { if (stato.centro && !stato.caricando && !document.hidden && $("pannello").hidden && !mappa._popup) ricalcola(); }, 60000);

  // Numero di versione lungo la diagonale della mappa
  $("filigrana-testo").textContent = "Versione " + (cfg.versione || "");
  function posizionaFiligrana() {
    const f = $("filigrana"), w = f.clientWidth, h = f.clientHeight;
    if (!w || !h) return;
    const diag = Math.hypot(w, h);
    f.style.setProperty("--fil-ang", (Math.atan2(h, w) * 180 / Math.PI).toFixed(1) + "deg");
    f.style.setProperty("--fil-size", Math.round(diag / 10.5) + "px");
  }
  posizionaFiligrana();
  window.addEventListener("resize", posizionaFiligrana);

  avviaGps();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    const cerano = !!navigator.serviceWorker.controller;
    let ricaricata = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (cerano && !ricaricata) { ricaricata = true; location.reload(); }
    });
    navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {});
  }
})();
