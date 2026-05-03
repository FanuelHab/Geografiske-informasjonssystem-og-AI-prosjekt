# IS218-Gruppe-14

## Prosjektnavn & TL;DR

**Nødhavn i Norge** — Webkart for Forsvaret og andre beredskapsaktører: vis nødhavn, bruk egen posisjon eller velg punkt med radius, og hent treff via **Supabase/PostGIS** (romlig avstand i databasen).

## Video av systemet

[▶ Se demo-video her](https://github.com/FanuelHab/IS218-Gruppe-14/raw/refs/heads/main/assets/Nødhavner%20i%20Norge,%2003.05.26.mp4)

## Oppgave 2: Beskrivelse av utvidelsen (romlig funksjonalitet)

Webkartet er utvidet med **romlig analyse knyttet til brukerinteraksjon** og tydelig **visuell tilbakemelding** i kartet.

I tillegg vises et **analysert kartlag**: *antall nødhavn per kommune* etter **gjeldende visning** (romlig aggregering). Når brukeren setter **fartøylengde (m)** og aktiverer filteret, telles kun havner som kan ta den lengden (K1/K2/K3 maks ca. 330/200/120 m); koropletten oppdateres da til den **avledede mengden** — kombinasjon av attributtregler og geografisk aggregering mot kommuner.

### 1. Dynamisk henting ved klikk og posisjon (Supabase / Spatial SQL)

- **Radius rundt valgt punkt:** Brukeren velger en avstand (10–500 km) med glidebryter, aktiverer «Finn nødhavner rundt punkt» og **klikker på kartet**. Applikasjonen sender da **klikkets koordinater** (`click_lng`, `click_lat`) og **søkeradius i meter** (`distance_meters`) til en **lagret funksjon i Supabase**: `get_nodhavn_within_distance`.
- Funksjonen kjører en **romlig filtrering i databasen** (PostGIS), slik at kun nødhavn som ligger innenfor den angitte avstanden fra klikkpunktet returneres. Klienten bygger GeoJSON av resultatsettet og oppdaterer kartlaget.
- **GPS-posisjon:** Med «Bruk posisjonen min» brukes samme RPC med **brukerens koordinater** som sentrum og standard radius (slik det er satt i grensesnittet), slik at analysen også er **dynamisk** ut fra faktisk posisjon.

Dette oppfyller kravet om at kartet henter data **basert på brukerinteraksjon** og at **ST-funksjoner** brukes via Supabase. Se **[SQL-Snippet](#sql-snippet)** nedenfor for funksjonen i databasen.

### 2. Visuell tilbakemelding (grensesnitt)

Etter en vellykket romlig spørring:

- **Markør** på det valgte punktet (klikk eller posisjon).
- **Sirkel** som viser søkeradiusen tydelig i kartet.
- **Nødhavn-laget** viser **kun treffene** innenfor radius (øvrige skjules i denne visningen), med samme popup-styling som ellers, slik at resultatene er **tydelig uthevet** i forhold til et generelt oversiktskart.

Statusfeltet i panelet oppdateres med antall treff innenfor valgt avstand.

## SQL-Snippet

Nedenfor er kjernen av den lagrede funksjonen **`get_nodhavn_within_distance`** i Supabase/PostGIS. Parametrene `click_lng`, `click_lat` og `distance_meters` sendes fra klienten (`assets/js/map.js` via `.rpc('get_nodhavn_within_distance', …)`).

**`ST_DWithin`** brukes i `WHERE` for å hente alle nødhavn innenfor radius (meter, geography). **`ST_Distance`** brukes i `SELECT` og `ORDER BY` for å vise og sortere etter avstand fra klikkpunktet.

```sql
SELECT
  n.id,
  n.longitude,
  n.latitude,
  n.navn,
  n.kommune,
  n.fylke,
  n.kategori,
  n.lenke_faktaark,
  n.forvaltningsstatus,
  n.nodhavnnummer,
  ST_Distance(
    n.geom,
    ST_SetSRID(ST_MakePoint(click_lng, click_lat), 4326)::geography
  ) AS distance_m
FROM public.nodhavn n
WHERE n.geom IS NOT NULL
  AND ST_DWithin(
    n.geom,
    ST_SetSRID(ST_MakePoint(click_lng, click_lat), 4326)::geography,
    distance_meters
  )
ORDER BY distance_m;
```

### `ST_Distance` (PostGIS-signatur i databasen)

```sql
SELECT public.ST_Distance($1::public.geometry, $2::public.geometry);
```

## Tech stack

| Lag | Teknologi |
|-----|-----------|
| **Kart** | Leaflet 1.9.4 (CDN), OpenStreetMap / CartoDB (fliser), valgfritt WMS (GeoNorge Topo2) |
| **Frontend** | Vanilla JS (`assets/js/`), HTML5, CSS (`css/style.css`), DM Sans |
| **Data** | Supabase (`@supabase/supabase-js` via CDN) med fallback til `data/nodhavn.geojson` |
| **Lokal server** | **Node** (`server/server.mjs`, Express) — statiske filer fra prosjektrot, `GET /api/health` |
| **Dev** | `npm run dev` eller `npm start` (Node port **3000** som standard), valgfritt VS Code-oppgave ved mappeåpning |

## Teknisk stack
- **Leaflet**: 1.9.4 (CDN via unpkg)
- **Supabase**: @supabase/supabase-js (CDN) – henting av nødhavndata fra databasen
- **OpenStreetMap / CartoDB**: Bakgrunnskart (OSM, Carto Lys) via Leaflet
- **WMS (OGC)**: GeoNorge Topo2 (ekstern karttjeneste, valgfritt lag)
- **JavaScript**: Vanilla JS, modulær oppbygning (ingen build step)
- **HTML/CSS**: HTML5 + CSS3 (designsystem med CSS-variabler, DM Sans)
- **Kjøring**: Statisk (åpne `index.html`) eller lokal webserver (Python/Node)
- **GeoPandas / Jupyter**: Romlig analyse og vektoranalyser i `Romlig Analyse.ipynb` (kjøres lokalt med Python)

## Romlig analyse (notebook på GitHub)

Notatboken for romlig analyse (utforskning av nødhavndata, buffer, overlay, aggregering m.m.) vises direkte på GitHub. Den består av **kodeceller** (Python) og **markdown-celler** med overskrifter og pekere til dokumentasjon.

**[Romlig Analyse.ipynb](https://github.com/FanuelHab/IS218-Gruppe-14/blob/main/Romlig%20Analyse.ipynb)**

Utdypende forklaringer i egne **markdown-filer** i repoet (f.eks. `analysis_first_cell.md`, `analysis_second_cell.md`, `analysis_third_cell.md` — én fil per dokumentert celle, referert fra notebooken).

## Prosjektstruktur

```
.
├── index.html              # Hovedside: kart, søkepanel, legend
├── Romlig Analyse.ipynb    # Jupyter: kodeceller + markdown; GeoPandas-analyse (se lenke over)
├── analysis_*.md           # Dokumentasjon til notebook-celler (referert fra .ipynb)
├── css/
│   └── style.css
├── assets/js/
│   ├── supabase.js         # Supabase-klient (window.supabase)
│   ├── popups.js           # Popup-innhold for nødhavn
│   ├── layers.js           # GeoJSON-lag, Supabase/fallback, WMS
│   └── map.js              # Kart, lagkontroll, radius-filter, panel-UI
├── data/
│   ├── nodhavn.geojson
│   ├── nodhavn_import.csv
│   └── README.md
├── server/
│   ├── server.mjs          # Express: statiske filer + /api/health
│   └── package.json
├── package.json            # workspaces: server, script "dev" / "start"
├── .vscode/
│   ├── tasks.json          # Valgfri auto-start: npm run dev ved mappeåpning
│   └── settings.json       # task.allowAutomaticTasks
└── README.md
```

### Frontend (rekkefølge i `index.html`)

| Fil | Ansvar |
|-----|--------|
| **supabase.js** | Oppretter `window.supabase`. |
| **popups.js** | `makePopupContent`, `escapeHtml`. |
| **layers.js** | Henter nødhavn, setter `window.nodhavnGeoJSON`, lag og styling. |
| **map.js** | Kart, lagkontroll, radius-filter (Supabase-RPC), panel-UI. |

### Backend (valgfri lokal Node-server)

| Tjeneste | Port | Innhold |
|----------|------|---------|
| **Node** (`npm run start` eller `node server/server.mjs`) | 3000 ( `PORT` ) | Statiske filer fra prosjektrot, `GET /api/health` |

## Getting started

### Kart og Supabase/geojson

1. Bruk en **lokal HTTP-server** (nettleseren blokkerer ofte `fetch` til GeoJSON fra `file://`).
   ```bash
   python -m http.server 8000
   ```
   Åpne `http://localhost:8000` (tilpass port).

2. Fyll inn Supabase URL og anon key i `assets/js/supabase.js` hvis du ønsker data fra database; ellers brukes `data/nodhavn.geojson`.

### Med Node (anbefalt ved Live Server)

1. **Installer avhengigheter** (prosjektrot — `workspaces` inkluderer `server/`)
   ```bash
   npm install
   ```

2. **Start server**
   ```bash
   npm run dev
   ```
   Express på `127.0.0.1:3000` ( `PORT` kan overstyres).

3. **Åpne appen** på `http://localhost:3000`, eller bruk Live Server på annen port — `GET /api/health` på 3000 skal gi `{"ok":true}`.

### VS Code: automatisk server

- Oppgaven **«Dev: Node-server (statiske filer)»** kan kjøre `npm run dev` **automatisk ved mappeåpning** (`.vscode/tasks.json`). Godkjenn **Allow automatic tasks** første gang.
- **`.vscode/settings.json`** har `task.allowAutomaticTasks`: `on`.

### Feilsøking

| Problem | Tiltak |
|--------|--------|
| `Failed to fetch` / tom respons | Sjekk at Node kjører på 3000 ved behov; åpne `/api/health`. |
| Live Server + HTTPS | Bruk HTTP Live Server, eller tilpass API til HTTPS; blandet innhold blokkerer `http://`-API. |
| Chrome «Private Network Access» | Express sender svar-header som tillater kall fra annen lokal port; oppdatert `server.mjs`. |

## Bruk

- **Kart:** Pan, zoom, lagkontroll (bakgrunn, nødhavn, eksternt lag).
- **Bruk posisjonen min:** Nødhavn innen valgt radius (Supabase-RPC + database).
- **Finn nødhavner rundt punkt:** Klikk etter å ha valgt radius; viser treff innenfor sirkel.
- **Vis alle nødhavner:** Nullstiller filter.

## Data og katalog

- **Legg inn / oppdater GeoJSON** under `data/`; se `data/README.md`.
- **Supabase:** Tabell `nodhavn` (flat `longitude`/`latitude` eller GeoJSON-struktur) — se `assets/js/layers.js`.

Oversikt over datasett (kort):

| Datasett | Kilde | Merknad |
|----------|--------|---------|
| Nødhavn (primær) | Supabase `nodhavn` | Konverteres til GeoJSON i klienten |
| Nødhavn (fallback) | `data/nodhavn.geojson` | Ved Supabase-feil |
| Avledet analyse (koroplett) | Beregnes i `assets/js/layers.js` | Antall nødhavn per kommune etter aktivt fartøysfilter (aggregering mot `data/kommuner.geojson`) |
| Bakgrunn | OSM / CartoDB | XYZ-fliser |
| Eksternt lag | GeoNorge Topo2 WMS | Valgfritt |

## Dataflyt (kort)

- **Nødhavn på kart:** `layers.js` → Supabase eller `fetch('data/nodhavn.geojson')` → `window.nodhavnGeoJSON` → Leaflet.
- **Radius / posisjon:** `map.js` + Supabase RPC `get_nodhavn_within_distance` der aktuelt.

## Forbedringspunkter & refleksjon

- Tilgjengelighet (WCAG), tydeligere lasting/feil, mobil/touch, tekstfilter på fylke/kommune/kategori.
- Offline/cache (service worker) for statisk innhold og fallback-GeoJSON.
- Tester og CI (lint, enkle smoke-tester for API).
- Tydeligere dokumentasjon av eksterne lag (lisenser, URL-er).

## License

Se LICENSE-filen.
