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

- **Dati salvati nel sito per tutta la Lombardia.** Ogni lunedì GitHub esegue `aggiorna_sentieri.js`
  (workflow `.github/workflows/pubblica.yml`): scarica da Overpass sentieri e punti della Lombardia allargata di 15 km,
  a blocchi di mezzo grado (35 richieste), unisce i pezzi dei sentieri tagliati tra un blocco e l'altro e li salva nella
  cartella `dati/` del sito, divisi in tessere da 0,1°. Ogni sentiero è salvato una volta sola (nella tessera dove inizia;
  le altre tessere che attraversa dicono dov'è) e la traccia tiene un punto ogni circa 5 metri.
  In Lombardia l'app legge da lì; fuori interroga i server pubblici di Overpass (2–15 km intorno a te).
- Come in Qui-Pets i dati **non** stanno nel repository, solo nel sito pubblicato: a ogni altra pubblicazione,
  o se Overpass non risponde, si ricopiano quelli già pubblicati. Per riscaricarli subito: Actions →
  *Pubblica sito e aggiorna sentieri* → *Run workflow*.
- Alla fine dello scaricamento arriva una notifica sull'iPhone con l'app **ntfy** (✅ / ⚠️ / ❌) se nel repository c'è
  il secret `NTFY_TOPIC` con il nome del canale (Settings → Secrets and variables → Actions).
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
- `aggiorna_sentieri.js`, `.github/workflows/pubblica.yml`: scaricamento settimanale della Lombardia e pubblicazione
- `dati/`: sentieri e punti, creata da GitHub solo nel sito pubblicato (non sta nel repository)
- `icon-*.png`, `favicon-64.png`, `apple-touch-icon.png`: logo Qui con le montagne
