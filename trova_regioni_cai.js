// Prova temporanea: per ogni lettera A-Z chiede a OSM2CAI quanti sentieri ha la regione
// e mostra un sentiero d'esempio (nome, ref, primo punto) per capire di che regione si tratta.
const API = "https://osm2cai.cai.it/api";
const H = { "User-Agent": "Qui-Trekking/1.0 (https://github.com/quivicino/Trekking)", Accept: "application/json" };
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) { const r = await fetch(url, { headers: H }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
(async () => {
  for (const u of [API + "/v2/regions", API + "/v1/regions", API + "/v2/regions/list"]) {
    try { console.log("ELENCO", u, JSON.stringify(await json(u)).slice(0, 3000)); } catch (e) { console.log("ELENCO", u, e.message); }
  }
  for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    let tot = 0, primo = null;
    for (const s of [1, 2, 3, 4]) {
      try { const d = await json(`${API}/v2/hiking-routes/region/${L}/${s}`); const k = Object.keys(d); tot += k.length; if (!primo && k.length) primo = k[0]; }
      catch (e) { /* niente */ }
      await attendi(1100);
    }
    let es = "";
    if (primo) {
      try {
        const g = await json(`${API}/v2/hiking-route/${primo}`);
        const p = g.properties || {};
        const c = JSON.stringify(g.geometry && g.geometry.coordinates).match(/-?\d+\.\d+,\s*-?\d+\.\d+/);
        es = JSON.stringify({ ref: p.ref, ref_REI: p.ref_REI, name: p.name, from: p.from, to: p.to, region: p.region || p.regions, sezione: p.section || p.sections, punto: c && c[0] });
      } catch (e) { es = e.message; }
      await attendi(1100);
    }
    console.log(`REGIONE ${L}: ${tot} sentieri ${es}`);
  }
})();
