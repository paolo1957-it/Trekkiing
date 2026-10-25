# Qui-Trekking

Web app per il telefono che mostra i **sentieri** vicino a te, con lo stesso aspetto e funzionamento di
[Qui-Pets](https://github.com/paolo1957-it/Pets) e [Distributori](https://github.com/paolo1957-it/Distributori):

- sentieri escursionistici di OpenStreetMap (relazioni `route=hiking`), colorati secondo la **difficoltà CAI**
  (`cai_scale`: T, E, EE, EEA, EAI; se manca, `sac_scale` convertita), con **numero** (`ref`) e **segnavia**
  (`osmc:symbol`, disegnato in SVG; per i sentieri CAI senza simbolo il classico bianco e rosso);
- **lunghezza** (tag `distance` o calcolata dalla traccia), **dislivello** in salita e discesa (tag `ascent`/`descent`
  oppure stimato dalle quote del terreno di [Open-Meteo](https://open-meteo.com/en/docs/elevation-api), con profilo
  altimetrico), quota minima e massima, **tempo di percorrenza** (tag `duration` o stima CAI/CAS: 4 km/h in piano,
  300 m/h in salita, 500 m/h in discesa);
- **rifugi** (`tourism=alpine_hut`), **bivacchi** e ricoveri (`tourism=wilderness_hut`, `amenity=shelter`),
  **fontanelle** (`amenity=drinking_water`, `water_point`, fontane potabili) e **sorgenti** (`natural=spring`).

## Come funziona

- I dati vengono chiesti direttamente a Overpass dal telefono, per un riquadro poco più largo del raggio scelto
  (2–15 km). Non c'è un workflow che li prepara: i sentieri con la loro traccia, per tutta Italia, sarebbero troppi.
- L'ultima risposta resta sul telefono (IndexedDB): in montagna senza campo l'app usa quella.
  Anche le quote calcolate e le foto delle fontanelle restano sul telefono.
- Pulsanti in basso: **rifugio** più vicino (aperto, se gli orari lo dicono) e **fontanella** più vicina.
- Mappe: topografica (OpenTopoMap, predefinita), stradale, stradale con nomi grandi, satellite.
- Nell'elenco c'è il pulsante per chiamare il **112** (soccorso alpino).

## Pubblicazione

Impostazioni del repository → Pages → Source: **GitHub Actions**. A ogni modifica su `main` il workflow
`.github/workflows/pubblica.yml` pubblica il sito su `https://paolo1957-it.github.io/Trekkiing/`.

## File

- `index.html`, `style.css`: interfaccia (stessi stili di Qui-Pets, barra verde bosco)
- `core.js`: logica (difficoltà, segnavia, unione dei tratti, lunghezza, dislivello, orari dei rifugi, query Overpass);
  si può usare anche da Node (`require("./core.js")`)
- `app.js`: mappa, GPS, sentieri, elenco, impostazioni
- `config.js`: impostazioni iniziali e numero di versione
- `sw.js`, `manifest.webmanifest`: installazione come app
- `.github/workflows/pubblica.yml`: pubblicazione su GitHub Pages
- `icon-*.png`, `favicon-64.png`, `apple-touch-icon.png`: logo Qui con le montagne
