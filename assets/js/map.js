/**
 * Når siden kjører på Live Server (f.eks. 5500) og API på 3000, må vi bruke full URL.
 * Samme hostname som siden (localhost vs 127.0.0.1 vs ::1) unngår rare tilkoblingsfeil.
 * Override: window.__SEAROUTE_API_BASE__ = 'http://127.0.0.1:3000'
 */
/** Maks LOA brukeren kan angi — samme tak som K1 (330 m) i nødhavn-regelverket i appen. */
const VESSEL_INPUT_MAX_M = 330;

function searouteApiUrl(path) {
  if (typeof window === 'undefined') return path;
  const override = window.__SEAROUTE_API_BASE__;
  if (override != null && String(override).trim() !== '') {
    const base = String(override).replace(/\/$/, '');
    return base + (path.startsWith('/') ? path : '/' + path);
  }
  let u;
  try {
    u = new URL(window.location.href);
  } catch {
    return path;
  }
  const port = u.port;
  const h = u.hostname;
  const isLocal =
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h === '::1';
  if (isLocal && port && port !== '3000') {
    const p = path.startsWith('/') ? path : '/' + path;
    try {
      const api = new URL(u.href);
      api.port = '3000';
      return api.origin + p;
    } catch {
      return `${u.protocol}//${h}:3000${p}`;
    }
  }
  return path;
}

class MapApp {
  constructor() {
    this.NORWAY_CENTER = [64.5, 11];
    this.DEFAULT_ZOOM = 5;
    this.DEFAULT_VIEW_BOUNDS = L.latLngBounds(
      [57.4, 2.0],
      [71.8, 33.5]
    );
    this.REGIONAL_MAX_BOUNDS = L.latLngBounds(
      [49.0, -15.0],
      [83.5, 42.0]
    );

    this.filterDistanceKm = 100;
    this.activeFilterCenter = null;

    this.filterRadiusLayer = null;
    this.closestResultLayer = null;
    this.currentMapClickHandler = null;
    /** Capture-fase klikk på kart-container (se setMapClickHandler) — samme funksjonsreferanse til removeEventListener. */
    this._spatialPickCaptureBound = null;

    this.map = this.initMap();
    this.baseLayers = this.initBaseLayers();
    this.nodhavnLayer = createNodhavnGeoJSONLayer();
    this.kommuneNodhavnLayer = createKommuneNodhavnDensityLayer();
    this.farlederLayer = createFarlederLayer();
    this.kommunerLayer = createKommunerLayer();
    this.externalLayer = createExternalLayer();

    this.initLayerControls();
    this.initUI();
    this.centerMapOnUserLocation();
  }

  // ---------------- MAP ----------------
  initMap() {
    const map = L.map('map', {
      wheelPxPerZoomLevel: 120,
      wheelDebounceTime: 80,
      zoomSnap: 1,
      zoomDelta: 1,
      zoomControl: false,
      minZoom: 3,
      maxBounds: this.REGIONAL_MAX_BOUNDS,
      maxBoundsViscosity: 0.7
    }).setView(this.NORWAY_CENTER, this.DEFAULT_ZOOM);

    map.fitBounds(this.DEFAULT_VIEW_BOUNDS, {
      animate: false,
      padding: [20, 20]
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    return map;
  }

  initBaseLayers() {
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    });

    const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO'
    });

    return {
      'CartoDB Lys': carto,
      'OpenStreetMap': osm
    };
  }

  initLayerControls() {
    if (this.baseLayers && this.baseLayers['CartoDB Lys']) {
      this.baseLayers['CartoDB Lys'].addTo(this.map);
    }

    // Rekkefølge: koroplett og farleder under nødhavn-punkter (sirkelmarkører skal ligge øverst).
    // Analyse (koroplett) er av som standard — skrus på i lagvelgeren.
    this.farlederLayer.addTo(this.map);
    this.nodhavnLayer.addTo(this.map);
    this.ensureNodhavnOnTop();

    this.map.on('overlayadd', () => {
      this.ensureNodhavnOnTop();
    });

    const overlays = {
      'Nødhavn (søkeresultat)': this.nodhavnLayer,
      'Analyse: Nødhavn per kommune': this.kommuneNodhavnLayer,
      'Farleder': this.farlederLayer,
      'Kommunegrenser': this.kommunerLayer,
      'Eksternt lag (OGC)': this.externalLayer
    };

    L.control.layers(this.baseLayers, overlays).addTo(this.map);

    const self = this;
    window.addEventListener('ensure-nodhavn-on-top', function () {
      self.ensureNodhavnOnTop();
    });
  }

  ensureNodhavnOnTop() {
    if (this.nodhavnLayer && this.map.hasLayer(this.nodhavnLayer)) {
      this.nodhavnLayer.bringToFront();
    }
  }

  /** Klikk som ikke skal tolkes som valg av søkepunkt (kontroller, popup, tooltip). */
  spatialPickIgnoreEventTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return !!(
      target.closest('.leaflet-control') ||
      target.closest('.leaflet-popup') ||
      target.closest('.leaflet-tooltip')
    );
  }

  /** Konsekvent L.LatLng for posisjon / klikk (unngår at {lat,lng} feiler stille i noen flyter). */
  normalizeFilterCenter(center) {
    if (center == null) return null;
    if (typeof center.lat === 'number' && typeof center.lng === 'number') {
      return L.latLng(center.lat, center.lng);
    }
    if (center.latitude != null && center.longitude != null) {
      return L.latLng(Number(center.latitude), Number(center.longitude));
    }
    return null;
  }

  // ---------------- SAFE CLICK HANDLER ----------------
  /**
   * Standard map.on('click') fyrer ikke når man treffer GeoJSON (kommune, farled, …).
   * Bruk capture-fase på kart-containeren slik at vi alltid får koordinat før vektorlag.
   */
  setMapClickHandler(handler) {
    const container = this.map.getContainer();

    if (this._spatialPickCaptureBound) {
      container.removeEventListener('click', this._spatialPickCaptureBound, true);
      this._spatialPickCaptureBound = null;
    }

    this.currentMapClickHandler = handler;

    if (!handler) {
      return;
    }

    this._spatialPickCaptureBound = (e) => {
      if (!this.currentMapClickHandler) return;
      if (e.button != null && e.button !== 0) return;
      if (this.spatialPickIgnoreEventTarget(e.target)) return;

      const latlng = this.map.mouseEventToLatLng(e);
      if (!latlng) return;

      L.DomEvent.stopPropagation(e);
      this.currentMapClickHandler({ latlng, originalEvent: e });
    };

    container.addEventListener('click', this._spatialPickCaptureBound, true);
  }

  // ---------------- CLOSEST HARBOR (sea routing via API) ----------------
  async handleClosestClick(latlng) {
    this.clearAllOverlays();

    const geojson =
      typeof window.getDisplayNodhavnGeoJSON === 'function'
        ? window.getDisplayNodhavnGeoJSON()
        : window.nodhavnGeoJSON;

    if (!geojson) {
      this.updateHint('Data lastes...');
      return;
    }

    if (!geojson.features || geojson.features.length === 0) {
      this.updateHint('Ingen nødhavn funnet.');
      return;
    }

    this.updateHint('Beregner sjøroute til nærmeste nødhavn...');

    const ports = geojson.features.map((feature, i) => {
      const [lng, lat] = feature.geometry.coordinates;
      return {
        lat,
        lng,
        index: i,
        properties: feature.properties || {}
      };
    });

    try {
      const res = await fetch(searouteApiUrl('/api/closest-port'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: latlng.lat, lng: latlng.lng },
          ports
        })
      });

      const raw = await res.text();
      const trimmed = raw.trim();

      if (!trimmed) {
        if (res.status === 404) {
          this.updateHint(
            'Ingen /api/closest-port (404). Sjekk at `npm run dev` kjører (eller VS Code-oppgaven «Dev: sjøroute-backend»), og at Live Server ikke blokkerer port 3000.'
          );
        } else {
          this.updateHint(`Sjøroute: tomt svar fra tjeneren (HTTP ${res.status}).`);
        }
        return;
      }

      let data;
      try {
        data = JSON.parse(trimmed);
      } catch {
        this.updateHint(
          'Sjøroute: tjeneren returnerte ikke JSON (sjekk at du bruker Node-proxyen på port 3000).'
        );
        return;
      }

      if (!res.ok) {
        const detail = data.detail;
        const msg =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
              : data.error || res.statusText;
        this.updateHint(`Sjøroute: ${msg}`);
        return;
      }

      const distanceKm = data.distance_km;
      const props = data.port_properties || {};
      const navn = props.navn || props.name || 'Nødhavn';
      const rounded = Number(distanceKm).toFixed(2);
      const category = props.kategori || '–';

      const portIdx = data.port_index;
      const portFeat = geojson.features[portIdx];
      if (!portFeat || !portFeat.geometry || portFeat.geometry.type !== 'Point') {
        this.updateHint('Kunne ikke plassere valgt havn (mangler punkt i GeoJSON).');
        return;
      }
      const [harborLngRaw, harborLatRaw] = portFeat.geometry.coordinates;
      const harborLng = data.port_lng != null ? Number(data.port_lng) : Number(harborLngRaw);
      const harborLat = data.port_lat != null ? Number(data.port_lat) : Number(harborLatRaw);

      this.updateHint(`Nærmeste (sjø): ${navn} – ${rounded} km`);

      const clickExact = L.latLng(latlng.lat, latlng.lng);
      const harborExact = L.latLng(harborLat, harborLng);

      const clickMarker = L.marker(clickExact)
        .addTo(this.map)
        .bindPopup(`<b>${navn}</b><br>Sjøvei: ${rounded} km<br>Kategori: ${category}`)
        .openPopup();

      const geom = data.geometry;
      if (!geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) {
        this.updateHint('Ugyldig sjørute fra tjeneren.');
        return;
      }

      const routeCoords = geom.coordinates.map((c) => [Number(c[0]), Number(c[1])]);
      if (routeCoords.length >= 1) {
        routeCoords[0] = [clickExact.lng, clickExact.lat];
      }
      if (routeCoords.length >= 2) {
        routeCoords[routeCoords.length - 1] = [harborExact.lng, harborExact.lat];
      }

      const latlngs = routeCoords.map((c) => L.latLng(c[1], c[0]));
      const line = L.polyline(latlngs, {
        color: '#0066cc',
        weight: 3,
        opacity: 0.9
      }).addTo(this.map);

      const harborMarker = L.marker(harborExact)
        .addTo(this.map)
        .bindPopup(`<b>${navn}</b><br>Sjøvei: ${rounded} km<br>Kategori: ${category}`);

      this.closestResultLayer = L.layerGroup([clickMarker, line, harborMarker]).addTo(this.map);
      const bounds = L.latLngBounds(clickExact, harborExact);
      latlngs.forEach((ll) => {
        bounds.extend(ll);
      });
      this.map.fitBounds(bounds.pad(0.15));
    } catch (err) {
      const msg = err && err.message ? err.message : 'Ukjent feil';
      this.updateHint(
        `Kunne ikke nå sjøroute-API (${msg}). Kjør «npm run dev» i prosjektroten (Node 3000 + Python 8001). Med Live Server: åpne http://127.0.0.1:3000/api/health i nettleser — skal vise {"ok":true}.`
      );
    }
  }

  // ---------------- FILTER --------------
  /**
   * Tegner sirkel + flyttbar markør for radius-søk. Ved drag oppdateres sirkelen;
   * ved dragend kjøres søket på nytt fra ny posisjon.
   */
  addDraggableFilterRadiusOverlay(latlng) {
    const radiusM = this.filterDistanceKm * 1000;
    const circle = L.circle(latlng, {
      radius: radiusM,
      color: '#0066cc',
      fillColor: '#0066cc',
      fillOpacity: 0.15,
      weight: 2,
      interactive: false
    });
    const marker = L.marker(latlng, {
      draggable: true,
      title: 'Dra for å flytte søkepunktet'
    }).bindPopup(
      `Valgt punkt<br>Radius: ${this.filterDistanceKm} km<br><small>Dra markøren for å flytte søket.</small>`
    );

    marker.on('drag', () => {
      circle.setLatLng(marker.getLatLng());
    });

    marker.on('dragend', () => {
      const ll = marker.getLatLng();
      this.activeFilterCenter = ll;
      circle.setLatLng(ll);
      this.applySpatialFilter(ll);
    });

    const group = L.layerGroup([circle, marker]);
    group.addTo(this.map);
    this.filterRadiusLayer = group;
    this.activeFilterCenter = latlng;
  }

  applySpatialFilter(latlng) {
    const client = window.supabase;

    if (!client) {
      this.updateHint('Supabase er ikke konfigurert. Bruk "Vis alle nødhavner" og prøv igjen.');
      return;
    }

    const ll = this.normalizeFilterCenter(latlng);
    if (!ll) {
      this.updateHint('Kunne ikke lese søkepunkt. Velg punkt på nytt.');
      return;
    }

    this.updateHint('Henter nødhavn fra databasen...');

    client
      .rpc('get_nodhavn_within_distance', {
      click_lng: ll.lng,
      click_lat: ll.lat,
      distance_meters: this.filterDistanceKm * 1000
    })
    .then(result => {
      if (result.error) {
        this.updateHint(`Feil: ${result.error.message || 'Kunne ikke hente data.'}`);
        return;
      }

      const rows = result.data || [];
      let features = rows.map(r => {
        const lng = Number(r.longitude);
        const latVal = Number(r.latitude);

        return {
          type: 'Feature',
          properties: {
            name: r.navn,
            navn: r.navn,
            kommune: r.kommune,
            fylke: r.fylke,
            type: r.kategori != null ? String(r.kategori) : '',
            kategori: r.kategori,
            lenke_faktaark: r.lenke_faktaark,
            forvaltningsstatus: r.forvaltningsstatus,
            nodhavnnummer: r.nodhavnnummer
          },
          geometry: { type: 'Point', coordinates: [lng, latVal] }
        };
      });

      const vesselM =
        typeof window.getVesselLengthFilterM === 'function' ? window.getVesselLengthFilterM() : null;
      if (vesselM && typeof window.featureAcceptsVesselLength === 'function') {
        features = features.filter((f) => window.featureAcceptsVesselLength(f, vesselM));
      }

      // Update layer to only show filtered results
      this.clearAllOverlays();
      this.nodhavnLayer.clearLayers();
      this.nodhavnLayer.addData({ type: 'FeatureCollection', features });
      this.nodhavnLayer.addTo(this.map);

      this.addDraggableFilterRadiusOverlay(ll);

      const n = features.length;
      this.setHintHasResults(n > 0);
      this.updateHint(`${n} nødhavn innenfor ${this.filterDistanceKm} km. Klikk på en markør for å se detaljer.`);

      if (n > 0 && this.nodhavnLayer.getBounds().isValid()) {
        this.map.fitBounds(this.nodhavnLayer.getBounds().pad(0.15));
      }
    })
    .catch(err => {
      this.updateHint(`Kunne ikke hente nødhavn: ${err.message || 'Ukjent feil'}`);
    });
  }

  // ---------------- CLEANUP ----------------
  clearAllOverlays() {
    if (this.filterRadiusLayer) {
      this.map.removeLayer(this.filterRadiusLayer);
      this.filterRadiusLayer = null;
    }

    if (this.closestResultLayer) {
      this.map.removeLayer(this.closestResultLayer);
      this.closestResultLayer = null;
    }
  }

  clearSpatialFilter() {
    this.clearAllOverlays();
    this.activeFilterCenter = null;
    this.nodhavnLayer.clearLayers();
    this.map.removeLayer(this.nodhavnLayer);
  }

  showAllNodhavn() {
    if (!window.nodhavnGeoJSON) {
      this.updateHint('Data lastes...');
      return;
    }

    window.__vesselLengthFilterM__ = null;
    if (this.vesselLengthInput) this.vesselLengthInput.value = '';

    this.clearAllOverlays();
    this.activeFilterCenter = null;

    if (typeof window.applyNodhavnDisplayFilter === 'function') {
      window.applyNodhavnDisplayFilter(this.nodhavnLayer);
    } else {
      this.nodhavnLayer.clearLayers();
      this.nodhavnLayer.addData(window.nodhavnGeoJSON);
    }
    this.nodhavnLayer.addTo(this.map);

    this.setMapClickHandler(null);
    this.setHintHasResults(false);
    this.updateHint('Alle nødhavn i Norge vises. Bruk søkefunksjonen for å filtrere.');
  }

  centerMapOnUserLocation() {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        this.map.setView([lat, lng], 8);
      },
      () => {
        // Behold standardutsnittet hvis posisjon ikke er tilgjengelig.
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
    );
  }

  // ---------------- UI ----------------
  initUI() {
    this.filterBtn = document.getElementById('filter-btn');
    this.resetBtn = document.getElementById('reset-btn');
    this.filterHint = document.getElementById('filter-hint');
    this.filterDistanceInput = document.getElementById('filter-distance');
    this.filterDistanceValue = document.getElementById('filter-distance-value');
    this.usePositionBtn = document.getElementById('use-position-btn');
    this.panelToggle = document.getElementById('panel-toggle');

    if (this.panelToggle) {
      const panelEl = document.getElementById('search-panel');
      const syncPanelToggle = () => {
        if (!panelEl || !this.panelToggle) return;
        const collapsed = panelEl.classList.contains('collapsed');
        this.panelToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        this.panelToggle.title = collapsed ? 'Vis meny' : 'Skjul meny';
      };
      this.panelToggle.addEventListener('click', () => {
        if (panelEl) panelEl.classList.toggle('collapsed');
        syncPanelToggle();
      });
      syncPanelToggle();
    }

    if (this.filterDistanceInput) {
      const updateDistanceDisplay = () => {
        if (this.filterDistanceValue) this.filterDistanceValue.textContent = this.filterDistanceInput.value;
      };

      this.filterDistanceInput.addEventListener('input', () => {
        updateDistanceDisplay();
        this.filterDistanceKm = Number(this.filterDistanceInput.value) || 100;
        if (this.activeFilterCenter) {
          const c = this.normalizeFilterCenter(this.activeFilterCenter);
          if (c) this.applySpatialFilter(c);
        }
      });

      updateDistanceDisplay();
      this.filterDistanceKm = Number(this.filterDistanceInput.value) || 100;
    }

    this.vesselLengthInput = document.getElementById('vessel-length-input');
    this.vesselFilterBtn = document.getElementById('vessel-filter-btn');

    if (this.vesselFilterBtn) {
      this.vesselFilterBtn.addEventListener('click', () => this.applyVesselLengthFilter());
    }
    if (this.vesselLengthInput) {
      this.vesselLengthInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.applyVesselLengthFilter();
        }
      });
    }

    if (this.filterBtn) {
      this.filterBtn.addEventListener('click', () => {
        this.filterDistanceKm = Number(this.filterDistanceInput?.value) || this.filterDistanceKm || 100;

        this.clearSpatialFilter();
        this.setHintHasResults(false);
        this.updateHint(`Klikk på kartet for å finne nødhavner innenfor ${this.filterDistanceKm} km.`);

        this.setMapClickHandler((e) => this.applySpatialFilter(e.latlng));
      });
    }

    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => this.showAllNodhavn());
    }

    if (this.usePositionBtn) {
      this.usePositionBtn.addEventListener('click', () => {
        this.setMapClickHandler(null);

        if (!navigator.geolocation) {
          this.updateHint('Støtte for geolokasjon er ikke tilgjengelig i nettleseren din.');
          return;
        }

        this.updateHint('Henter posisjon...');

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const userLatLng = { lat, lng };

            // Keep the same default behavior as before
            this.filterDistanceKm = Number(this.filterDistanceInput?.value) || 100;
            this.applySpatialFilter(userLatLng);
            this.map.setView([lat, lng], 8);
          },
          (err) => {
            if (err.code === 1) {
              this.updateHint('Posisjon avvist. Gi nettleseren tillatelse til å bruke posisjonen din.');
            } else if (err.code === 2) {
              this.updateHint('Kunne ikke bestemme posisjon (ukjent lokasjon).');
            } else {
              this.updateHint(`Kunne ikke hente posisjon: ${err.message || 'Ukjent feil'}`);
            }
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      });
    }
  }

  setHintHasResults(hasResults) {
    if (!this.filterHint) return;
    if (hasResults) this.filterHint.classList.add('has-results');
    else this.filterHint.classList.remove('has-results');
  }

  updateHint(text) {
    if (this.filterHint) {
      this.filterHint.textContent = text;
    }
  }

  applyVesselLengthFilter() {
    const raw = this.vesselLengthInput ? this.vesselLengthInput.value : '';
    const trimmed = raw != null ? String(raw).trim() : '';
    if (trimmed === '') {
      this.updateHint('Skriv fartøylengde i meter, eller trykk «Vis alle nødhavner» for å tilbakestille.');
      return;
    }
    let n = Number(trimmed);
    if (isNaN(n) || n <= 0) {
      this.updateHint('Ugyldig lengde. Bruk et positivt tall (meter).');
      return;
    }
    if (n > VESSEL_INPUT_MAX_M) {
      n = VESSEL_INPUT_MAX_M;
      if (this.vesselLengthInput) this.vesselLengthInput.value = String(VESSEL_INPUT_MAX_M);
      this.updateHint(`Lengden er begrenset til maks ${VESSEL_INPUT_MAX_M} m (største kategori i kartet).`);
    }
    window.__vesselLengthFilterM__ = n;
    if (typeof window.applyNodhavnDisplayFilter === 'function') {
      window.applyNodhavnDisplayFilter(this.nodhavnLayer);
    }
    this.nodhavnLayer.addTo(this.map);
    this.nodhavnLayer.bringToFront();

    if (this.activeFilterCenter) {
      const c = this.normalizeFilterCenter(this.activeFilterCenter);
      if (c) this.applySpatialFilter(c);
      return;
    }

    const gjeldende =
      typeof window.getDisplayNodhavnGeoJSON === 'function'
        ? window.getDisplayNodhavnGeoJSON()
        : null;
    const count = gjeldende && gjeldende.features ? gjeldende.features.length : 0;
    this.setHintHasResults(count > 0);
    this.updateHint(
      `Fartøysfilter ${n} m: ${count} egnede havner vises (K1/K2/K3 etter maks lengde 330/200/120 m).`
    );
  }
}

// Start
new MapApp();