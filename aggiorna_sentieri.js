#!/usr/bin/env node
/*
 * Qui-Trekking – scarica una volta alla settimana da OpenStreetMap (Overpass) sentieri, rifugi, bivacchi,
 * fontanelle e sorgenti delle zone usate più spesso e li salva nel sito, divisi in "tessere".
 * Nelle zone l'app legge da qui e non dipende dai server pubblici di OpenStreetMap, spesso lenti o fuori uso.
 *
 * Lo esegue GitHub da solo (vedi .github/workflows/pubblica.yml). I file finiscono nella cartella dati/.
 * Per aggiungere una zona basta aggiungere una riga in ZONE qui sotto:
 *     "nome": [latitudine sud, longitudine ovest, latitudine nord, longitudine est]
 * I valori si trovano su https://bboxfinder.com
 *
 * Uso: node aggiorna_sentieri.js   (variabile d'ambiente ESITO: file dove scrivere l'esito per la notifica)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const QT = require("./core.js");

// Stesse zone di Qui Parcheggi
const ZONE = {
  // Pavia con Travacò Siccomario e Villanova d'Ardenghi
  "Pavia": [45.100, 9.010, 45.260, 9.215],
  "Milano": [45.380, 9.030, 45.540, 9.290],
  // Varese e Biandronno con i paesi in mezzo, il Campo dei Fiori e il lago di Varese
  "Varese e Biandronno": [45.770, 8.675, 45.880, 8.890]
};
// Ogni zona si scarica allargata di 15 km per lato: così chi è dentro la zona trova tutto
// anche col raggio più grande (15 km)
const MARGINE_KM = 15;
const PASSO = 0.1;          // lato della tessera in gradi (circa 11 × 8 km)
const CARTELLA = path.join(__dirname, "dati");
const USER_AGENT = "Qui-Trekking/1.0 (https://github.com/paolo1957-it/Trekkiing)";
const SERVER = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (nome) => nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function allarga([s, w, n, e]) {
  const dLat = MARGINE_KM / 111.32;
  const dLon = MARGINE_KM / (111.32 * Math.cos(((s + n) / 2) * Math.PI / 180));
  return [s - dLat, w - dLon, n + dLat, e + dLon].map((x) => +x.toFixed(4));
}

async function scarica(query) {
  let ultimo;
  for (let giro = 0; giro < 3; giro++) {
    for (const url of SERVER) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6 * 60000);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: "data=" + encodeURIComponent(query),
          signal: ctrl.signal
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const dati = await r.json();
        if (!Array.isArray(dati.elements)) throw new Error("risposta senza elementi");
        if (dati.remark && /error|timed out|out of memory|rate/i.test(dati.remark)) throw new Error(dati.remark);
        console.log(`  ok da ${url}: ${dati.elements.length} elementi`);
        return dati;
      } catch (e) {
        ultimo = e;
        console.log(`  ${url}: ${e.message}`);
      } finally {
        clearTimeout(t);
      }
    }
    await attendi(60000 * (giro + 1));
  }
  throw new Error("nessun server ha risposto: " + (ultimo && ultimo.message));
}

const nomeTessera = (lat, lon) => `t_${Math.floor(lat / PASSO)}_${Math.floor(lon / PASSO)}.json`;

// Ogni sentiero va in tutte le tessere che attraversa (l'app toglie i doppioni); ogni punto nella sua
function inTessere(sentieri, punti) {
  const tessere = new Map();
  const prendi = (t) => { if (!tessere.has(t)) tessere.set(t, { s: [], p: [] }); return tessere.get(t); };
  for (const s of sentieri) {
    const nomi = new Set();
    for (const l of s.g) for (const [la, lo] of l) nomi.add(nomeTessera(la, lo));
    for (const t of nomi) prendi(t).s.push(s);
  }
  for (const p of punti) prendi(nomeTessera(p.la, p.lo)).p.push(p);
  return tessere;
}

async function main() {
  fs.mkdirSync(CARTELLA, { recursive: true });
  const fileIndice = path.join(CARTELLA, "indice.json");
  let indice;
  try { indice = JSON.parse(fs.readFileSync(fileIndice, "utf8")); } catch (e) { indice = { zone: {} }; }
  indice.passo = PASSO;
  // zone tolte da ZONE: via anche i loro file
  for (const nome of Object.keys(indice.zone)) {
    if (!ZONE[nome]) { fs.rmSync(path.join(CARTELLA, indice.zone[nome].cartella || slug(nome)), { recursive: true, force: true }); delete indice.zone[nome]; }
  }

  let errori = 0;
  for (const [nome, bbox] of Object.entries(ZONE)) {
    console.log(`${nome}…`);
    const largo = allarga(bbox);
    let dati;
    try {
      dati = await scarica(QT.queryOverpass(largo, 300));
    } catch (e) {
      console.log(`  ${nome} NON aggiornata, resta la versione precedente: ${e.message}`);
      errori++;
      continue;
    }
    const { sentieri, punti } = QT.leggiRisposta(dati);
    const tessere = inTessere(sentieri, punti);
    const cartella = slug(nome);
    fs.rmSync(path.join(CARTELLA, cartella), { recursive: true, force: true });
    fs.mkdirSync(path.join(CARTELLA, cartella), { recursive: true });
    for (const [t, cont] of tessere) fs.writeFileSync(path.join(CARTELLA, cartella, t), JSON.stringify(cont));
    indice.zone[nome] = {
      bbox,
      scaricata: largo,
      cartella,
      aggiornato: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      sentieri: sentieri.length,
      punti: punti.length,
      tessere: [...tessere.keys()].sort()
    };
    console.log(`  ${sentieri.length} sentieri e ${punti.length} punti in ${tessere.size} tessere`);
  }
  indice.fonte = "© OpenStreetMap contributors (ODbL)";
  fs.writeFileSync(fileIndice, JSON.stringify(indice, null, 1));
  // Per la notifica sull'iPhone: riga "zone aggiornate;zone totali" (vedi .github/workflows/pubblica.yml)
  const tot = Object.keys(ZONE).length;
  if (process.env.ESITO) fs.writeFileSync(process.env.ESITO, `${tot - errori};${tot}\n`);
  if (errori === tot) process.exitCode = 1;
}

if (require.main === module) main();
else module.exports = { ZONE, allarga, inTessere, slug };
