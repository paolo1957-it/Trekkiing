/*
 * Qui-Trekking – logica pura (nessun accesso a DOM o rete).
 * Funziona sia nel browser (window.QT) sia in Node (module.exports), così si può provare con node.
 */
(function (root) {
  "use strict";

  const R_TERRA = 6371000;

  function distanza(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R_TERRA * Math.asin(Math.sqrt(a));
  }

  function formattaDistanza(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + " m";
    return (m / 1000).toFixed(1).replace(".", ",") + " km";
  }
  const formattaKm = (m) => (m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",") + " km";
  const formattaQuota = (m) => Math.round(m).toLocaleString("it-IT") + " m";
  function formattaOre(min) {
    min = Math.round(min / 5) * 5;
    const h = Math.floor(min / 60), m = min % 60;
    return h ? h + " h" + (m ? " " + String(m).padStart(2, "0") : "") : m + " min";
  }

  // ---------- Difficoltà dei sentieri (scala CAI) ----------
  // Su OpenStreetMap è nel tag cai_scale; se manca si usa sac_scale (scala svizzera) convertita.
  const DIFFICOLTA = {
    T: { nome: "Turistico", sigla: "T", spiega: "Stradine, mulattiere e sentieri larghi e facili, vicino a paesi o rifugi. Adatto a tutti, anche ai bambini." },
    E: { nome: "Escursionistico", sigla: "E", spiega: "Sentieri segnalati anche ripidi, su terreni vari (pascoli, detriti, pietraie). Servono scarponi, allenamento e un po' di senso dell'orientamento." },
    EE: { nome: "Escursionisti esperti", sigla: "EE", spiega: "Sentieri a volte poco tracciati, con passaggi esposti, ghiaioni o brevi tratti di roccia facile. Servono esperienza, piede fermo e niente vertigini." },
    EEA: { nome: "Esperti con attrezzatura", sigla: "EEA", spiega: "Vie ferrate e sentieri attrezzati con cavi, scale e pioli. Obbligatori imbrago, set da ferrata e casco." },
    EAI: { nome: "In ambiente innevato", sigla: "EAI", spiega: "Percorsi su neve con racchette o ramponi. Servono attrezzatura invernale e conoscenza del pericolo valanghe." },
    ND: { nome: "Difficoltà non indicata", sigla: "?", spiega: "Su OpenStreetMap la difficoltà di questo sentiero non è ancora scritta." }
  };
  const ORDINE_DIFF = ["T", "E", "EE", "EEA", "EAI", "ND"];
  const DA_SAC = {
    hiking: "T", mountain_hiking: "E", demanding_mountain_hiking: "EE",
    alpine_hiking: "EE", demanding_alpine_hiking: "EEA", difficult_alpine_hiking: "EEA"
  };

  function difficolta(t) {
    t = t || {};
    const c = String(t.cai_scale || "").trim().toUpperCase().replace(/\s+/g, "");
    if (/^EAI/.test(c)) return "EAI";
    if (/^EEA/.test(c)) return "EEA";
    if (/^EE/.test(c)) return "EE";
    if (/^E/.test(c)) return "E";
    if (/^T/.test(c)) return "T";
    return DA_SAC[t.sac_scale] || "ND";
  }

  // ---------- Tipi di punti ----------
  // Ogni punto ha un codice "k". L'ordine qui è quello del menu e della guida.
  const TIPI = {
    R: { nome: "Rifugio", plurale: "Rifugi" },
    B: { nome: "Bivacco", plurale: "Bivacchi e ricoveri" },
    W: { nome: "Fontanella", plurale: "Fontanelle" },
    S: { nome: "Sorgente", plurale: "Sorgenti" }
  };

  /** Codice del tipo di punto a partire dai tag OSM, oppure null se non interessa. */
  function tipoDaTag(t) {
    t = t || {};
    if (t.tourism === "alpine_hut") return "R";
    if (t.tourism === "wilderness_hut" || (t.amenity === "shelter" && /^(basic_hut|lean_to|rock_shelter)$/.test(t.shelter_type || ""))) return "B";
    if (t.amenity === "drinking_water" || (t.amenity === "fountain" && t.drinking_water === "yes") ||
        (t.amenity === "water_point" && t.drinking_water !== "no")) return "W";
    if (t.natural === "spring") return "S";
    return null;
  }

  // Punto compatto: solo i campi che servono all'app
  function compatta(el) {
    const t = el.tags || {};
    const k = tipoDaTag(t);
    if (!k) return null;
    const la = el.lat ?? (el.center && el.center.lat);
    const lo = el.lon ?? (el.center && el.center.lon);
    if (la == null || lo == null) return null;
    const p = { i: el.type[0] + el.id, k, la: +la.toFixed(6), lo: +lo.toFixed(6) };
    const metti = (chiave, v) => { v = String(v ?? "").trim(); if (v) p[chiave] = v; };
    metti("n", t.name || t["name:it"]);
    metti("q", parseFloat(String(t.ele || "").replace(",", ".")) ? Math.round(parseFloat(String(t.ele).replace(",", "."))) : "");
    metti("h", t.opening_hours);
    metti("t", t.phone || t["contact:phone"] || t["contact:mobile"]);
    metti("w", t.website || t["contact:website"] || t.url);
    metti("o", t.operator);
    metti("p", t.beds || t.capacity);
    const info = [];
    if (k === "R" || k === "B") {
      if (t.fireplace === "yes") info.push("con stufa o camino");
      if (t.drinking_water === "yes") info.push("acqua potabile");
      if (t.reservation === "required") info.push("prenotazione obbligatoria");
    }
    if (k === "W" || k === "S") {
      if (k === "S" && t.drinking_water === "yes") info.push("acqua potabile");
      if (t.drinking_water === "no") info.push("acqua non potabile");
      if (t.drinking_water === "conditional" || t["drinking_water:legal"] === "no") info.push("potabilità non garantita");
      if (t.seasonal === "yes" || t.seasonal === "summer") info.push("solo in alcuni mesi");
      if (t.intermittent === "yes") info.push("a volte asciutta");
    }
    if (info.length) p.x = info.join(", ");
    return p;
  }

  // ---------- Simbolo del sentiero (osmc:symbol) ----------
  // Formato: colore_via:sfondo[_forma]:disegno[:testo:colore_testo], es. "red:white:red_bar:123:black"
  const COLORI = {
    red: "#d52b1e", white: "#ffffff", yellow: "#f6c700", blue: "#1f5bd6", green: "#1d8a3c", black: "#111111",
    orange: "#f28a1a", purple: "#7a3fb2", brown: "#7a4a1d", gray: "#888888", grey: "#888888"
  };
  function leggiSimbolo(s) {
    const parti = String(s || "").split(":");
    if (parti.length < 2) return null;
    const [, sfondo = "", disegno = "", testo = "", coloreTesto = ""] = parti;
    const [colSf, formaSf] = sfondo.split("_");
    const m = disegno.match(/^([a-z]+)_(.+)$/);
    return {
      sfondo: COLORI[colSf] || null,
      formaSfondo: formaSf || "",
      colore: m ? COLORI[m[1]] || null : null,
      forma: m ? m[2] : "",
      testo: testo.slice(0, 4),
      coloreTesto: COLORI[coloreTesto] || "#111111"
    };
  }
  // Senza osmc:symbol, i sentieri CAI hanno il segnavia bianco e rosso
  const SIMBOLO_CAI = { sfondo: "#d52b1e", formaSfondo: "", colore: "#ffffff", forma: "bar", testo: "", coloreTesto: "#111111" };

  /** Segnavia disegnato in SVG (lato "n" pixel). */
  function svgSimbolo(sim, n, testo) {
    n = n || 28;
    sim = sim || SIMBOLO_CAI;
    const txt = (testo ?? sim.testo) || "";
    const larghezza = txt.length > 2 ? 34 : 24;
    const W = larghezza, H = 24;
    const c = sim.colore || "#ffffff";
    const forme = {
      bar: `<rect x="0" y="8" width="${W}" height="8" fill="${c}"/>`,
      stripe: `<rect x="${W / 2 - 4}" y="0" width="8" height="${H}" fill="${c}"/>`,
      cross: `<path d="M${W / 2 - 2.5} 4h5v5.5h5.5v5H${W / 2 + 2.5}V20h-5v-5.5H${W / 2 - 8}v-5h5.5z" fill="${c}"/>`,
      x: `<path d="M${W / 2 - 8} 4l16 16M${W / 2 + 8} 4L${W / 2 - 8} 20" stroke="${c}" stroke-width="4"/>`,
      dot: `<circle cx="${W / 2}" cy="12" r="6.5" fill="${c}"/>`,
      circle: `<circle cx="${W / 2}" cy="12" r="6" fill="none" stroke="${c}" stroke-width="3"/>`,
      triangle: `<path d="M${W / 2} 4l8 15H${W / 2 - 8}z" fill="${c}"/>`,
      diamond: `<path d="M${W / 2} 3l8 9-8 9-8-9z" fill="${c}"/>`,
      lower: `<rect x="0" y="12" width="${W}" height="12" fill="${c}"/>`,
      corner: `<path d="M0 0h${W}L0 ${H}z" fill="${c}"/>`,
      rectangle: `<rect x="${W / 2 - 7}" y="5" width="14" height="14" fill="${c}"/>`,
      fork: `<path d="M${W / 2} 22V12M${W / 2} 12L${W / 2 - 7} 3M${W / 2} 12l7-9" stroke="${c}" stroke-width="3.5" fill="none"/>`,
      arch: `<path d="M${W / 2 - 8} 20a8 8 0 0 1 16 0" stroke="${c}" stroke-width="4" fill="none"/>`,
      hiker: `<circle cx="${W / 2}" cy="5" r="2.5" fill="${c}"/><path d="M${W / 2} 8v7l-3 6M${W / 2} 15l3 6M${W / 2 - 3} 11h6" stroke="${c}" stroke-width="2.4" fill="none"/>`
    };
    const disegno = forme[sim.forma.replace(/_line$/, "")] || "";
    const sfondo = sim.sfondo || "#ffffff";
    const cornice = sim.formaSfondo === "frame" ? `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="${sfondo}" stroke-width="3"/>` : "";
    const fondo = sim.formaSfondo === "frame" ? "#ffffff" : sim.formaSfondo === "circle" ? "#ffffff" : sfondo;
    const tondo = sim.formaSfondo === "circle" ? `<circle cx="${W / 2}" cy="12" r="10" fill="none" stroke="${sfondo}" stroke-width="3"/>` : "";
    // il testo su fondo scuro va in bianco se il colore indicato non si leggerebbe
    const col = sim.coloreTesto || "#111111";
    const scritta = txt ? `<text x="${W / 2}" y="16.2" text-anchor="middle" font-family="Barlow Semi Condensed, Arial Narrow, sans-serif" font-weight="700" font-size="${txt.length > 3 ? 10 : 11.5}" fill="${col}" stroke="#ffffff" stroke-width="2.2" paint-order="stroke">${esc(txt)}</text>` : "";
    return `<svg class="segnavia" viewBox="0 0 ${W} ${H}" width="${Math.round(n * W / 24)}" height="${Math.round(n)}" aria-hidden="true">` +
      `<rect width="${W}" height="${H}" rx="2" fill="${fondo}"/>${cornice}${tondo}${disegno}${scritta}` +
      `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="2" fill="none" stroke="rgba(0,0,0,.35)"/></svg>`;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Sentieri (relazioni route=hiking) ----------
  // Le vie di un sentiero non sono sempre in ordine: si uniscono in tratti continui unendo le estremità vicine.
  function unisciTratti(vie) {
    const tratti = vie.filter((v) => v.length > 1).map((v) => v.slice());
    const vicino = (a, b) => distanza(a[0], a[1], b[0], b[1]) < 25;
    let cambiato = true;
    while (cambiato) {
      cambiato = false;
      for (let i = 0; i < tratti.length && !cambiato; i++) {
        for (let j = i + 1; j < tratti.length && !cambiato; j++) {
          const a = tratti[i], b = tratti[j];
          const ai = a[0], af = a[a.length - 1], bi = b[0], bf = b[b.length - 1];
          let nuovo = null;
          if (vicino(af, bi)) nuovo = a.concat(b.slice(1));
          else if (vicino(af, bf)) nuovo = a.concat(b.slice(0, -1).reverse());
          else if (vicino(ai, bf)) nuovo = b.concat(a.slice(1));
          else if (vicino(ai, bi)) nuovo = b.slice().reverse().concat(a.slice(1));
          if (nuovo) { tratti[i] = nuovo; tratti.splice(j, 1); cambiato = true; }
        }
      }
    }
    return tratti.sort((x, y) => lunghezzaLinea(y) - lunghezzaLinea(x));
  }
  function lunghezzaLinea(l) {
    let s = 0;
    for (let i = 1; i < l.length; i++) s += distanza(l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]);
    return s;
  }
  const numero = (v) => { const x = parseFloat(String(v || "").replace(",", ".")); return isFinite(x) ? x : null; };
  // "distance" può essere in km ("12.5", "12,5 km") o in metri ("800 m")
  function metriDaTag(v) {
    const s = String(v || "").trim().toLowerCase();
    const x = numero(s);
    if (x == null) return null;
    if (/\bm$/.test(s) && !/km$/.test(s)) return x;
    if (/mi$/.test(s)) return x * 1609;
    return x * 1000;
  }
  // "duration" come "3:30", "03:30", "3h30", "PT3H30M" o "3"
  function minutiDaTag(v) {
    const s = String(v || "").trim();
    let m = s.match(/^(\d{1,2})[:.h](\d{1,2})/i) || s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
    if (m) return (+(m[1] || 0)) * 60 + (+(m[2] || 0));
    m = s.match(/^(\d+(?:[.,]\d+)?)\s*h?$/i);
    if (m) return Math.round(parseFloat(m[1].replace(",", ".")) * 60);
    return null;
  }

  /** Sentiero compatto da una relazione Overpass "out tags geom". */
  function compattaSentiero(el) {
    const t = el.tags || {};
    if (el.type !== "relation") return null;
    const vie = (el.members || []).filter((m) => m.type === "way" && m.geometry && !/^(alternative|excursion|approach|connection|guidepost|platform)$/.test(m.role || ""))
      .map((m) => m.geometry.filter(Boolean).map((g) => [+g.lat.toFixed(5), +g.lon.toFixed(5)]));
    if (!vie.length) return null;
    const tratti = unisciTratti(vie);
    const lunghezzaCalcolata = tratti.reduce((s, l) => s + lunghezzaLinea(l), 0);
    const s = {
      i: "r" + el.id,
      g: tratti,
      d: difficolta(t),
      l: Math.round(metriDaTag(t.distance) || lunghezzaCalcolata)
    };
    const metti = (chiave, v) => { v = String(v ?? "").trim(); if (v) s[chiave] = v; };
    metti("r", t.ref);
    metti("n", t.name || t["name:it"]);
    metti("da", t.from);
    metti("a", t.to);
    metti("o", t.operator);
    metti("rete", t.network);
    metti("c", t.cai_scale);
    metti("sim", t["osmc:symbol"]);
    metti("w", t.website);
    metti("nota", t.description || t.note_it || "");
    const salita = numero(t.ascent), discesa = numero(t.descent);
    if (salita != null) s.su = Math.round(salita);
    if (discesa != null) s.giu = Math.round(discesa);
    const durata = minutiDaTag(t.duration);
    if (durata) s.t = durata;
    if (t.roundtrip === "yes") s.anello = 1;
    // sentiero CAI: gestito dal CAI o col segnavia bianco e rosso
    if (/\bcai\b|club alpino/i.test([t.operator, t.network, t.name].join(" ")) || /^red:(red|white)/.test(t["osmc:symbol"] || "")) s.cai = 1;
    return s;
  }

  // Punto del sentiero più vicino a (lat, lon), con la sua distanza
  function puntoPiuVicino(s, lat, lon) {
    let best = null, dmin = Infinity;
    for (const l of s.g) for (const p of l) {
      const d = distanza(lat, lon, p[0], p[1]);
      if (d < dmin) { dmin = d; best = p; }
    }
    return { punto: best, distanza: dmin };
  }

  // Estremità del sentiero (inizio e fine dei tratti), per "Portami all'attacco"
  function estremita(s) {
    return s.g.flatMap((l) => [l[0], l[l.length - 1]]);
  }

  /** Campioni (al massimo "max") distribuiti lungo i tratti, per chiedere le quote. */
  function campioni(s, max) {
    max = max || 100;
    const tot = s.g.reduce((a, l) => a + lunghezzaLinea(l), 0);
    if (!tot) return [];
    const passo = Math.max(tot / (max - s.g.length), 20);
    const out = [];
    s.g.forEach((l, it) => {
      let resto = 0;
      out.push({ la: l[0][0], lo: l[0][1], tratto: it, km: 0 });
      let km = 0;
      for (let i = 1; i < l.length; i++) {
        const [a1, o1] = l[i - 1], [a2, o2] = l[i];
        const d = distanza(a1, o1, a2, o2);
        let x = passo - resto;
        while (x <= d) {
          const f = x / d;
          out.push({ la: a1 + (a2 - a1) * f, lo: o1 + (o2 - o1) * f, tratto: it, km: km + x });
          x += passo;
        }
        resto = d - (x - passo);
        km += d;
      }
      const ul = l[l.length - 1];
      out.push({ la: ul[0], lo: ul[1], tratto: it, km });
    });
    return out.slice(0, max);
  }

  /** Dislivello da una serie di quote: si ignorano le variazioni sotto "soglia" metri (rumore del modello). */
  function dislivello(quote, tratti, soglia) {
    soglia = soglia ?? 8;
    let su = 0, giu = 0, min = Infinity, max = -Infinity;
    let rif = null, trattoPrec = null;
    quote.forEach((q, i) => {
      if (q == null || !isFinite(q)) return;
      min = Math.min(min, q); max = Math.max(max, q);
      const tr = tratti ? tratti[i] : 0;
      if (rif === null || tr !== trattoPrec) { rif = q; trattoPrec = tr; return; }
      if (q - rif >= soglia) { su += q - rif; rif = q; }
      else if (rif - q >= soglia) { giu += rif - q; rif = q; }
    });
    if (min === Infinity) return null;
    return { su: Math.round(su), giu: Math.round(giu), min: Math.round(min), max: Math.round(max) };
  }

  // Tempo di percorrenza stimato (formula usata dal CAI e dal Club alpino svizzero):
  // 4 km/h in piano, 300 m/h in salita, 500 m/h in discesa; si somma il maggiore con metà del minore.
  function tempoStimato(metri, su, giu) {
    const orizz = metri / 4000 * 60;
    const vert = (su || 0) / 300 * 60 + (giu || 0) / 500 * 60;
    return Math.max(orizz, vert) + Math.min(orizz, vert) / 2;
  }

  function titoloSentiero(s) {
    if (s.n) return s.n;
    if (s.r) return (s.cai ? "Sentiero CAI " : "Sentiero ") + s.r;
    return "Sentiero senza nome";
  }
  function sottotitoloSentiero(s) {
    const p = [];
    if (s.r && s.n) p.push((s.cai ? "Sentiero CAI " : "Sentiero ") + s.r);
    if (s.da && s.a) p.push(s.da + " → " + s.a);
    return p.join(" · ");
  }

  // ---------- Orari di apertura (opening_hours di OSM), come in Qui-Pets ----------
  const GIORNI = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const GIORNI_IT = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];
  const GIORNI_BREVI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const MESI = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MESI_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const RE_GIORNO = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)";

  // I rifugi hanno quasi sempre orari stagionali: "Jun 15-Sep 20" o "Jun-Sep: 08:00-22:00". Si capisce se oggi
  // è nel periodo; quello che segue i mesi si legge come un orario normale.
  function periodoMesi(testo, quando) {
    const s = String(testo || "").trim();
    const m = s.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s*\d{1,2})?)\s*-\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s*\d{1,2})?)\s*:?\s*(.*)$/);
    if (!m) return null;
    const leggi = (x, fine) => {
      const [, mese, g] = x.match(/^(\w{3})\s*(\d{1,2})?$/);
      const i = MESI.indexOf(mese);
      return i * 100 + (g ? +g : fine ? 31 : 1);
    };
    const ini = leggi(m[1], false), fin = leggi(m[2], true);
    const ora = quando ? new Date(quando) : new Date();
    const oggi = ora.getMonth() * 100 + ora.getDate();
    const dentro = ini <= fin ? oggi >= ini && oggi <= fin : oggi >= ini || oggi <= fin;
    return { dentro, resto: m[3].trim() };
  }

  function leggiOrari(testo) {
    let s = String(testo || "").trim();
    if (!s) return null;
    if (/^24\/7$/.test(s) || /^Mo-Su 00:00-24:00$/.test(s)) return GIORNI.map(() => [[0, 1440]]);
    if (/["\[\]|]|sunrise|sunset|dawn|dusk|easter|week|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\d\+/i.test(s)) return null;
    s = s.replace(/[–—]/g, "-").replace(/\s+/g, " ");
    const regole = s.split(";").flatMap((r) =>
      r.split(new RegExp("(?<=\\d|off|closed)\\s*,\\s*(?=" + RE_GIORNO + "\\b)"))).map((r) => r.trim()).filter(Boolean);
    const settimana = GIORNI.map(() => []);
    for (let regola of regole) {
      if (/^24\/7\b/.test(regola)) regola = regola.replace(/^24\/7/, "Mo-Su 00:00-24:00");
      const m = regola.match(new RegExp("^(" + RE_GIORNO + "(?:-" + RE_GIORNO + ")?(?:\\s*,\\s*" + RE_GIORNO + "(?:-" + RE_GIORNO + ")?)*)?\\s*(.*)$"));
      if (!m) return null;
      let giorni;
      if (m[1]) {
        giorni = new Set();
        let soloFestivi = true;
        for (const parte of m[1].split(/\s*,\s*/)) {
          const [a, b] = parte.split("-");
          if (a === "PH" || a === "SH") continue;
          soloFestivi = false;
          const i = GIORNI.indexOf(a), j = b ? GIORNI.indexOf(b) : i;
          if (i < 0 || j < 0) return null;
          for (let g = i; ; g = (g + 1) % 7) { giorni.add(g); if (g === j) break; }
        }
        if (soloFestivi) continue;
      } else {
        giorni = new Set([0, 1, 2, 3, 4, 5, 6]);
      }
      const corpo = m[2].trim();
      let fasce;
      if (/^(off|closed)$/i.test(corpo)) fasce = [];
      else if (corpo === "" || /^open$/i.test(corpo)) fasce = [[0, 1440]];
      else {
        fasce = [];
        for (const f of corpo.split(/\s*,\s*/)) {
          const t = f.match(/^(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})$/);
          if (!t) return null;
          const ini = +t[1] * 60 + +t[2];
          let fin = +t[3] * 60 + +t[4];
          if (ini > 1440 || fin > 1440 * 2) return null;
          if (fin <= ini) fin += 1440;
          fasce.push([ini, fin]);
        }
      }
      for (const g of giorni) settimana[g] = fasce.slice();
    }
    return settimana;
  }

  const giornoSettimana = (data) => (data.getDay() + 6) % 7;
  const hhmm = (min) => { min = ((min % 1440) + 1440) % 1440; return Math.floor(min / 60) + ":" + String(min % 60).padStart(2, "0"); };

  function statoApertura(orari, quando) {
    const periodo = periodoMesi(orari, quando);
    if (periodo) {
      if (!periodo.dentro) return { aperto: false, stagione: true };
      if (!periodo.resto) return { aperto: true, stagione: true };
      orari = periodo.resto;
    }
    const sett = leggiOrari(orari);
    if (!sett) return null;
    const ora = quando ? new Date(quando) : new Date();
    const g = giornoSettimana(ora), min = ora.getHours() * 60 + ora.getMinutes();
    if (sett.every((f) => f.length === 1 && f[0][0] === 0 && f[0][1] >= 1440)) return { aperto: true, sempre: !periodo, stagione: !!periodo };
    const candidati = [
      ...sett[g].map(([a, b]) => [a, b]),
      ...sett[(g + 6) % 7].filter(([, b]) => b > 1440).map(([a, b]) => [a - 1440, b - 1440])
    ];
    for (const [a, b] of candidati) if (min >= a && min < b) return { aperto: true, chiude: b };
    for (let d = 0; d < 8; d++) {
      const fasce = sett[(g + d) % 7].filter(([a]) => d > 0 || a > min).sort((x, y) => x[0] - y[0]);
      if (fasce.length) return { aperto: false, apre: { giorni: d, giorno: (g + d) % 7, min: fasce[0][0] } };
    }
    return { aperto: false, apre: null };
  }

  function testoApertura(st) {
    if (!st) return "";
    if (st.aperto) {
      if (st.sempre) return "Aperto 24 ore su 24";
      if (st.chiude != null) return "Aperto ora · chiude alle " + hhmm(st.chiude);
      return "Aperto in questa stagione";
    }
    if (st.stagione && !st.apre) return "Chiuso in questa stagione";
    if (!st.apre) return "Chiuso";
    const { giorni, giorno, min } = st.apre;
    const q = giorni === 0 ? "alle " : giorni === 1 ? "domani alle " : GIORNI_IT[giorno] + " alle ";
    return "Chiuso · apre " + q + hhmm(min);
  }

  function orariLeggibili(testo) {
    const s = String(testo || "").trim();
    if (!s) return [];
    if (s === "24/7") return ["Sempre aperto"];
    const mese = (x) => MESI_IT[MESI.indexOf(x)];
    return s.split(";").map((r) => r.trim()).filter(Boolean).map((r) => r
      // "Jun 15-Sep 20" → "dal 15 giu al 20 set"
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\s*-\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\b/g,
        (x, m1, g1, m2, g2) => `dal ${g1} ${mese(m1)} al ${g2} ${mese(m2)}`)
      .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (x) => GIORNI_BREVI[GIORNI.indexOf(x)])
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (x) => MESI_IT[MESI.indexOf(x)])
      .replace(/\bPH\b/g, "festivi").replace(/\bSH\b/g, "vacanze scolastiche")
      .replace(/\b(off|closed)\b/gi, "chiuso").replace(/(\d)\s*-\s*(\d)/g, "$1–$2")
      .replace(/,(?=\S)/g, ", "));
  }

  // ---------- Overpass ----------
  // Riquadro (sud, ovest, nord, est) che contiene il cerchio di ricerca
  function riquadro(lat, lon, raggio) {
    const dLat = raggio / 111320, dLon = raggio / (111320 * Math.cos(lat * Math.PI / 180));
    return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((x) => +x.toFixed(5));
  }
  // Sentieri escursionistici (esclusi i grandi itinerari europei, lunghissimi) e punti utili, in un riquadro
  function queryOverpass(bbox, timeout) {
    const b = `(${bbox.join(",")})`;
    return `[out:json][timeout:${timeout || 40}][maxsize:200000000];` +
      `relation${b}[route=hiking][type=route][network!=iwn];out tags geom;` +
      `(nwr${b}[tourism~"^(alpine_hut|wilderness_hut)$"];` +
      `nwr${b}[amenity=shelter][shelter_type~"^(basic_hut|lean_to|rock_shelter)$"];` +
      `node${b}[amenity=drinking_water];` +
      `node${b}[amenity=water_point];` +
      `node${b}[amenity=fountain][drinking_water=yes];` +
      `node${b}[natural=spring];` +
      `);out center tags;`;
  }

  /** Divide la risposta di Overpass in sentieri e punti. */
  function leggiRisposta(dati) {
    const sentieri = [], punti = [];
    for (const el of (dati && dati.elements) || []) {
      if (el.type === "relation" && el.tags && el.tags.route === "hiking") {
        const s = compattaSentiero(el);
        if (s) sentieri.push(s);
      } else {
        const p = compatta(el);
        if (p) punti.push(p);
      }
    }
    return { sentieri, punti };
  }

  // ---------- Vicini ----------
  function preparaPunti(lista, lat, lon, raggio, scelti, quando) {
    const out = [], visti = new Set();
    for (const d of lista || []) {
      if (visti.has(d.i)) continue;
      visti.add(d.i);
      if (scelti && !scelti.has(d.k)) continue;
      const dist = distanza(lat, lon, d.la, d.lo);
      if (dist > raggio) continue;
      out.push({ ...d, distanza: dist, apertura: d.h ? statoApertura(d.h, quando) : null });
    }
    return out;
  }
  function prepareSentieri(lista, lat, lon, raggio, scelti) {
    const out = [], visti = new Set();
    for (const s of lista || []) {
      if (visti.has(s.i)) continue;
      visti.add(s.i);
      if (scelti && !scelti.has("D" + s.d)) continue;
      const v = puntoPiuVicino(s, lat, lon);
      if (v.distanza > raggio) continue;
      out.push({ ...s, distanza: v.distanza, vicino: v.punto });
    }
    return out;
  }

  // ---------- Testi ----------
  function capitalizza(s) {
    s = String(s || "").trim();
    if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) {
      const minuscole = /^(di|de|del|dei|degli|della|delle|dello|da|dal|dalla|al|alla|e|ed|in|sul|sulla|per)$/;
      return s.toLowerCase().replace(/(^|[\s'’.\-/(])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase())
        .replace(/(\s)([A-ZÀ-Ù][a-zà-ù]*)(?=\s)/g, (m, sp, w) => minuscole.test(w.toLowerCase()) ? sp + w.toLowerCase() : m);
    }
    return s;
  }
  const nomeTipo = (d) => TIPI[d.k].nome;
  const titolo = (d) => capitalizza(d.n) || nomeTipo(d);

  const API = {
    distanza, formattaDistanza, formattaKm, formattaQuota, formattaOre, DIFFICOLTA, ORDINE_DIFF, difficolta,
    TIPI, tipoDaTag, compatta, leggiSimbolo, svgSimbolo, SIMBOLO_CAI, unisciTratti, lunghezzaLinea, metriDaTag, minutiDaTag,
    compattaSentiero, puntoPiuVicino, estremita, campioni, dislivello, tempoStimato, titoloSentiero, sottotitoloSentiero,
    leggiOrari, statoApertura, testoApertura, orariLeggibili, riquadro, queryOverpass, leggiRisposta,
    preparaPunti, prepareSentieri, capitalizza, nomeTipo, titolo
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.QT = API;
})(typeof window !== "undefined" ? window : globalThis);
