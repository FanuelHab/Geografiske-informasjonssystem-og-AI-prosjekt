/**
 * Tabellnavn i Supabase. Støtter:
 * 1) Flat tabell med longitude, latitude, navn, kommune, fylke, kategori osv. (bygger GeoJSON)
 * 2) Én rad med kolonne som inneholder FeatureCollection
 * 3) Flere rader med "geometry" og "properties"
 */
var NODHAVN_TABLE = 'nodhavn';

/**
 * Henter data fra Supabase og returnerer GeoJSON FeatureCollection.
 * Tabellen nodhavn har: longitude, latitude, navn, kommune, fylke, kategori, osv.
 */
function fetchNodhavnFromSupabase() {
  var client = window.supabase;
  if (!client) {
    return Promise.reject(new Error('Supabase er ikke konfigurert. Fyll inn URL og anon key i js/supabase.js'));
  }

  return client
    .from(NODHAVN_TABLE)
    .select('*')
    .then(function (result) {
      if (result.error) throw new Error(result.error.message);
      var rows = result.data;
      if (!rows || rows.length === 0) {
        throw new Error('Ingen data i tabellen "' + NODHAVN_TABLE + '"');
      }
      var first = rows[0];
      // Tabell med longitude/latitude (flat kolonner) – slik nodhavn-tabellen er bygget
      var lon = first.longitude;
      var lat = first.latitude;
      if (typeof lon === 'number' && typeof lat === 'number') {
        return {
          type: 'FeatureCollection',
          features: rows.map(function (r) {
            var lng = Number(r.longitude);
            var latVal = Number(r.latitude);
            if (typeof lng !== 'number' || typeof latVal !== 'number' || isNaN(lng) || isNaN(latVal)) return null;
            return {
              type: 'Feature',
              properties: {
                name: r.navn,
                navn: r.navn,
                kommune: r.kommune,
                fylke: r.fylke,
                type: r.kategori != null ? String(r.kategori) : (r.navn || ''),
                kategori: r.kategori,
                lenke_faktaark: r.lenke_faktaark,
                forvaltningsstatus: r.forvaltningsstatus,
                nodhavnnummer: r.nodhavnnummer
              },
              geometry: { type: 'Point', coordinates: [lng, latVal] }
            };
          }).filter(Boolean)
        };
      }
      // Én rad med en kolonne som inneholder hele FeatureCollection
      var key;
      for (key in first) {
        if (first.hasOwnProperty(key)) {
          var val = first[key];
          if (val && typeof val === 'object' && (val.type === 'FeatureCollection' || (Array.isArray(val.features) && val.features.length > 0))) {
            return val;
          }
        }
      }
      // Flere rader: hver rad har geometry + properties
      if (first.geometry != null && first.properties !== undefined) {
        return {
          type: 'FeatureCollection',
          features: rows.map(function (r) {
            return { type: 'Feature', properties: r.properties || {}, geometry: r.geometry };
          })
        };
      }
      throw new Error('Ukjent tabellstruktur. Forventer longitude/latitude, eller GeoJSON FeatureCollection, eller geometry+properties per rad.');
    });
}

function announceNodhavnDataReady(geojson) {
  if (typeof window === 'undefined') return;
  window.nodhavnGeoJSON = geojson;
  if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('nodhavn-data-ready', { detail: geojson }));
  }
}

function announceKommunerDataReady(geojson) {
  if (typeof window === 'undefined') return;
  window.kommunerGeoJSON = geojson;
  if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('kommuner-data-ready', { detail: geojson }));
  }
}

/** Maks LOA (m) per Kystverket-kategori — samme tall som i legenden (K1/K2/K3). */
var VESSEL_MAX_LENGTH_BY_KATEGORI = { 1: 330, 2: 200, 3: 120 };

function parseKategoriTall(props) {
  if (!props) return null;
  var k = props.kategori != null ? props.kategori : props.type;
  var n = Number(k);
  if (!isNaN(n) && n >= 1 && n <= 3) return n;
  return null;
}

function harborMaxLengthM(props) {
  var cat = parseKategoriTall(props);
  if (cat == null) return Infinity;
  var m = VESSEL_MAX_LENGTH_BY_KATEGORI[cat];
  return m != null ? m : Infinity;
}

function featureAcceptsVesselLength(feature, vesselLengthM) {
  if (vesselLengthM == null || vesselLengthM <= 0 || isNaN(vesselLengthM)) return true;
  var maxM = harborMaxLengthM(feature.properties || {});
  return vesselLengthM <= maxM;
}

function filterGeoJSONByVesselLength(geojson, vesselLengthM) {
  if (!geojson || !geojson.features) return geojson;
  if (vesselLengthM == null || vesselLengthM <= 0 || isNaN(vesselLengthM)) return geojson;
  return {
    type: 'FeatureCollection',
    features: geojson.features.filter(function (f) {
      return featureAcceptsVesselLength(f, vesselLengthM);
    })
  };
}

function getVesselLengthFilterM() {
  if (typeof window === 'undefined') return null;
  var v = window.__vesselLengthFilterM__;
  if (v == null || v === '') return null;
  var n = Number(v);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

function getDisplayNodhavnGeoJSON() {
  var base = typeof window !== 'undefined' ? window.nodhavnGeoJSON : null;
  if (!base) return null;
  var Lm = getVesselLengthFilterM();
  return filterGeoJSONByVesselLength(base, Lm);
}

function notifyNodhavnZOrder() {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('ensure-nodhavn-on-top'));
  }
}

function applyNodhavnDisplayFilter(layer) {
  var data = getDisplayNodhavnGeoJSON();
  if (!data || !layer) return;
  layer.clearLayers();
  layer.addData(data);
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('nodhavn-display-changed'));
  }
  notifyNodhavnZOrder();
}

if (typeof window !== 'undefined') {
  window.getDisplayNodhavnGeoJSON = getDisplayNodhavnGeoJSON;
  window.getVesselLengthFilterM = getVesselLengthFilterM;
  window.featureAcceptsVesselLength = featureAcceptsVesselLength;
  window.applyNodhavnDisplayFilter = applyNodhavnDisplayFilter;
}

/**
 * Lager og returnerer GeoJSON-lag for nødhavn (fra Supabase, eller lokalt fil som fallback).
 * Datadrevet styling og popups brukes her.
 */
function createNodhavnGeoJSONLayer() {
  var layer = L.geoJSON(null, {
    pointToLayer: function (feature, latlng) {
      var props = feature.properties || {};
      var color = getColorByType(props.type || props.kategori);
      return L.circleMarker(latlng, {
        radius: 8,
        fillColor: color,
        color: '#333',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      });
    },
    onEachFeature: function (feature, markerLayer) {
      if (feature.properties) {
        markerLayer.bindPopup(makePopupContent(feature.properties), {
          closeButton: true,
          autoClose: false
        });
        markerLayer.on('click', function (e) {
          if (e.originalEvent) {
            e.originalEvent.stopPropagation();
          }
        });
      }
    }
  });

  fetchNodhavnFromSupabase()
    .then(function (geojson) {
      announceNodhavnDataReady(geojson);
      applyNodhavnDisplayFilter(layer);
    })
    .catch(function (err) {
      fetch('data/nodhavn.geojson')
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('Kunne ikke laste GeoJSON')); })
        .then(function (geojson) {
          announceNodhavnDataReady(geojson);
          applyNodhavnDisplayFilter(layer);
        })
        .catch(function () {
          console.warn('Kunne ikke laste nødhavn (verken Supabase eller lokal fil).');
        });
    });

  return layer;
}

function normalizeKommuneNavn(name) {
  if (name == null || name === '') return '';
  return String(name).trim().toLowerCase();
}

/**
 * GeoJSON point-in-polygon (kommune choropleth) uses Turf.js loaded via CDN (global `turf`).
 * See index.html: @turf/turf@7.x — exposes window.turf with booleanPointInPolygon, etc.
 */
function getTurfLibrary() {
  if (typeof turf !== 'undefined' && turf && typeof turf.booleanPointInPolygon === 'function') {
    return turf;
  }
  return null;
}

/**
 * Returns true if kommune geometry can be tested with Turf booleanPointInPolygon (Polygon / MultiPolygon).
 */
function isKommunePolygonGeometryForTurf(geom) {
  if (!geom || !geom.type) return false;
  return geom.type === 'Polygon' || geom.type === 'MultiPolygon';
}

/**
 * Point-in-polygon test using Turf.js on WGS84 GeoJSON (EPSG:4326 lon/lat).
 * This is real geographic analysis: containment is determined from polygon rings, not attribute fields.
 *
 * Used to build the processed kommune dataset required for the GIS assignment (nødhavn per kommune).
 */
function nodhavnPointInKommunePolygon(turfLib, pointFeature, kommunePolygonFeature) {
  if (!turfLib || !pointFeature || !kommunePolygonFeature) return false;
  var g = kommunePolygonFeature.geometry;
  if (!isKommunePolygonGeometryForTurf(g)) return false;
  try {
    return turfLib.booleanPointInPolygon(pointFeature, kommunePolygonFeature);
  } catch (err) {
    console.warn('Turf booleanPointInPolygon failed:', err);
    return false;
  }
}

/**
 * FALLBACK ONLY — Teller nødhavn per kommune basert på punktets tekstfelt «kommune».
 * Brukes når Turf mangler, kaster unntak, eller for enkeltpunkter som ikke treffer noen kommune-polygon.
 */
function aggregateNodhavnCountsByKommune(nodhavnGeoJSON) {
  var counts = {};
  var features = nodhavnGeoJSON && Array.isArray(nodhavnGeoJSON.features) ? nodhavnGeoJSON.features : [];
  features.forEach(function (f) {
    var props = f && f.properties ? f.properties : {};
    var raw = props.kommune != null ? props.kommune : props.Kommune;
    if (raw == null || raw === '') return;
    var key = normalizeKommuneNavn(raw);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function kommunePolygonNavn(props) {
  if (!props) return '';
  var n = props.kommunenavn != null ? props.kommunenavn : firstValue(props.navn);
  return n != null ? String(n) : '';
}

/**
 * Builds enriched kommune polygons for the choropleth.
 *
 * @param {object} kommunerGeoJSON - Polygon FeatureCollection (kommunegrenser).
 * @param {number[]|object} counts - Per-feature counts by polygon index (spatial analysis), OR name-keyed object (fallback).
 * @param {string} analyseLabel - Feature property `analyse` documenting how the dataset was produced.
 */
function buildKommuneNodhavnDensityGeoJSON(kommunerGeoJSON, counts, analyseLabel) {
  var label =
    analyseLabel ||
    'kommune_nodhavn_point_in_polygon';
  var features = kommunerGeoJSON && Array.isArray(kommunerGeoJSON.features) ? kommunerGeoJSON.features : [];
  var maxN = 0;
  var useArray = Array.isArray(counts);
  var enriched = features.map(function (f, idx) {
    var props = f.properties || {};
    var navn = kommunePolygonNavn(props);
    var key = normalizeKommuneNavn(navn);
    var n = useArray ? (counts[idx] != null ? Number(counts[idx]) : 0) : key ? counts[key] || 0 : 0;
    if (n > maxN) maxN = n;
    return {
      type: 'Feature',
      properties: Object.assign({}, props, {
        analyse: label,
        antall_nodhavn: n,
        _kommune_navn_visning: navn
      }),
      geometry: f.geometry
    };
  });
  return {
    fc: { type: 'FeatureCollection', features: enriched },
    maxAntall: maxN
  };
}

/**
 * PRIMARY PATH — Geographic analysis for the GIS assignment:
 * For each nødhavn point, determine kommune membership using Turf.js booleanPointInPolygon
 * against kommune polygon geometries (WGS84). Counts are stored per polygon feature index
 * so MultiPolygon / multiple parts stay accurate.
 *
 * Points that fall outside all polygons (coasts, data drift) are attributed once using the
 * FALLBACK attribute «kommune» — first polygon whose administrative name matches that text.
 *
 * @returns {{ countsByIndex: number[], spatialHits: number }}
 */
function aggregateNodhavnCountsByPointInPolygon(turfLib, nodhavnGeoJSON, kommunerGeoJSON) {
  var polyFeatures = kommunerGeoJSON && Array.isArray(kommunerGeoJSON.features) ? kommunerGeoJSON.features : [];
  var pointFeatures = nodhavnGeoJSON && Array.isArray(nodhavnGeoJSON.features) ? nodhavnGeoJSON.features : [];
  var countsByIndex = polyFeatures.map(function () {
    return 0;
  });
  var spatialHits = 0;

  for (var pi = 0; pi < pointFeatures.length; pi++) {
    var ptFeat = pointFeatures[pi];
    if (!ptFeat || !ptFeat.geometry || ptFeat.geometry.type !== 'Point') continue;

    var foundPoly = false;
    for (var ki = 0; ki < polyFeatures.length; ki++) {
      if (nodhavnPointInKommunePolygon(turfLib, ptFeat, polyFeatures[ki])) {
        countsByIndex[ki]++;
        spatialHits++;
        foundPoly = true;
        break;
      }
    }

    if (!foundPoly) {
      var props = ptFeat.properties || {};
      var raw = props.kommune != null ? props.kommune : props.Kommune;
      var fk = raw != null ? normalizeKommuneNavn(raw) : '';
      if (fk) {
        for (var j = 0; j < polyFeatures.length; j++) {
          var polyNameKey = normalizeKommuneNavn(kommunePolygonNavn(polyFeatures[j].properties || {}));
          if (polyNameKey && polyNameKey === fk) {
            countsByIndex[j]++;
            break;
          }
        }
      }
    }
  }

  return { countsByIndex: countsByIndex, spatialHits: spatialHits };
}

/**
 * Runs spatial aggregation when Turf is available; otherwise full attribute-based fallback.
 */
function buildKommuneNodhavnChoroplethDataset(nodhavnGeoJSON, kommunerGeoJSON) {
  var turfLib = getTurfLibrary();
  if (!turfLib) {
    console.warn(
      'Turf.js ikke tilgjengelig — bruker reservemetode (telling via punktattributt «kommune»).'
    );
    var fbCounts = aggregateNodhavnCountsByKommune(nodhavnGeoJSON);
    return buildKommuneNodhavnDensityGeoJSON(
      kommunerGeoJSON,
      fbCounts,
      'kommune_nodhavn_attribute_fallback'
    );
  }

  try {
    var agg = aggregateNodhavnCountsByPointInPolygon(turfLib, nodhavnGeoJSON, kommunerGeoJSON);
    return buildKommuneNodhavnDensityGeoJSON(
      kommunerGeoJSON,
      agg.countsByIndex,
      'kommune_nodhavn_point_in_polygon'
    );
  } catch (err) {
    console.warn('Romlig analyse feilet — faller tilbake til attributtbasert telling:', err);
    var fallbackCounts = aggregateNodhavnCountsByKommune(nodhavnGeoJSON);
    return buildKommuneNodhavnDensityGeoJSON(
      kommunerGeoJSON,
      fallbackCounts,
      'kommune_nodhavn_attribute_fallback'
    );
  }
}

function choroplethFillColor(antall, maxAntall) {
  if (!antall || antall <= 0) return '#e9ecef';
  if (!maxAntall || maxAntall <= 0) return '#74c0fc';
  var t = Math.min(1, antall / maxAntall);
  var hue = 205 - t * 55;
  var sat = 62 + t * 28;
  var light = 94 - t * 52;
  return 'hsl(' + hue + ',' + sat + '%,' + light + '%)';
}

/**
 * Koroplett «Analyse: Nødhavn per kommune»: datasettet bygges primært med punkt-i-polygon-analyse
 * (Turf.js booleanPointInPolygon) mot lokale kommune-polygoner — se buildKommuneNodhavnChoroplethDataset.
 * Reserve: attributtbasert telling kun ved manglende Turf eller feil i romlig beregning.
 */
function createKommuneNodhavnDensityLayer() {
  var nodhavnData = typeof window !== 'undefined' && window.nodhavnGeoJSON ? window.nodhavnGeoJSON : null;
  var kommunerData = typeof window !== 'undefined' && window.kommunerGeoJSON ? window.kommunerGeoJSON : null;
  var maxAntallRef = { value: 0 };

  var layer = L.geoJSON(null, {
    style: function (feature) {
      var n = feature.properties && feature.properties.antall_nodhavn != null ? Number(feature.properties.antall_nodhavn) : 0;
      var maxN = maxAntallRef.value || 1;
      return {
        color: '#495057',
        weight: n > 0 ? 1 : 0.5,
        opacity: 0.65,
        fillColor: choroplethFillColor(n, maxN),
        fillOpacity: n > 0 ? 0.55 : 0.15
      };
    },
    onEachFeature: function (feature, polygonLayer) {
      var p = feature.properties || {};
      var navn = p._kommune_navn_visning || kommunePolygonNavn(p) || 'Ukjent';
      var nr = p.kommunenummer || '–';
      var ant = p.antall_nodhavn != null ? p.antall_nodhavn : 0;
      polygonLayer.bindPopup(
        '<div class="popup-content">' +
          '<p><strong>Kommune:</strong> ' + escapeHtml(String(navn)) + '</p>' +
          '<p><strong>Kommunenummer:</strong> ' + escapeHtml(String(nr)) + '</p>' +
          '<p><strong>Nødhavner i kommunen:</strong> ' + escapeHtml(String(ant)) + '</p>' +
        '</div>'
      );
    }
  });

  function refresh() {
    if (!kommunerData) return;
    var source =
      typeof getDisplayNodhavnGeoJSON === 'function' ? getDisplayNodhavnGeoJSON() : nodhavnData;
    if (!source) return;
    var built = buildKommuneNodhavnChoroplethDataset(source, kommunerData);
    maxAntallRef.value = built.maxAntall;
    layer.clearLayers();
    layer.addData(built.fc);
    notifyNodhavnZOrder();
  }

  if (typeof window !== 'undefined') {
    nodhavnData = window.nodhavnGeoJSON || nodhavnData;
    kommunerData = window.kommunerGeoJSON || kommunerData;
    refresh();
    window.addEventListener('nodhavn-data-ready', function (evt) {
      nodhavnData = evt.detail;
      refresh();
    });
    window.addEventListener('kommuner-data-ready', function (evt) {
      kommunerData = evt.detail;
      refresh();
    });
    window.addEventListener('nodhavn-display-changed', function () {
      refresh();
    });
  }

  return layer;
}

/**
 * Farge basert på type (datadrevet styling). Oppdater feltnavn/kategorier når Hamdi leverer.
 */
function getColorByType(type) {
  if (type == null || type === '') return '#3388ff';
  var t = String(type).toLowerCase();
  if (t === '1' || t.indexOf('militær') !== -1 || t === 'military') return '#c0392b';
  if (t === '2' || t.indexOf('sivil') !== -1 || t === 'civil') return '#27ae60';
  if (t === '3' || t.indexOf('fiskeri') !== -1 || t === 'fishing') return '#8e44ad';
  return '#3388ff';
}

/**
 * Eksternt lag (OGC/WMS). Placeholder – Person 3 kan erstatte URL og params.
 * Eksempel: WMS fra GeoNorge.
 */
function createExternalLayer() {
  return L.tileLayer.wms('https://openwms.geonorge.no/skwms1/wms.topo2?', {
    layers: 'topo2_WMS',
    format: 'image/png',
    transparent: true,
    attribution: '© Kartverket/GeoNorge'
  });
}

/**
 * Farleder fra lokal GeoJSON-fil.
 */
function createFarlederLayer() {
  var layer = L.geoJSON(null, {
    style: function (feature) {
      var props = feature && feature.properties ? feature.properties : {};
      var isMainRoute = String(props.farledtype || '').toLowerCase().indexOf('hoved') !== -1;
      return {
        color: isMainRoute ? '#0b7285' : '#4dabf7',
        weight: isMainRoute ? 3 : 2,
        opacity: 0.85
      };
    },
    onEachFeature: function (feature, lineLayer) {
      var p = feature.properties || {};
      var navn = p.farlednavn || 'Ukjent farled';
      var nummer = p.farlednummer || '–';
      var type = p.farledtype || '–';
      lineLayer.bindPopup(
        '<div class="popup-content">' +
          '<p><strong>Farled:</strong> ' + escapeHtml(String(navn)) + '</p>' +
          '<p><strong>Nummer:</strong> ' + escapeHtml(String(nummer)) + '</p>' +
          '<p><strong>Type:</strong> ' + escapeHtml(String(type)) + '</p>' +
        '</div>'
      );
    }
  });

  fetch('data/farleder.geojson')
    .then(function (res) {
      if (!res.ok) throw new Error('Kunne ikke laste farleder.geojson');
      return res.json();
    })
    .then(function (geojson) {
      layer.addData(geojson);
    })
    .catch(function () {
      console.warn('Kunne ikke laste farleder fra data/farleder.geojson.');
    });

  return layer;
}

function firstValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : null;
  }
  return value;
}

/**
 * Kommunegrenser fra lokal GeoJSON-fil.
 */
function createKommunerLayer() {
  var layer = L.geoJSON(null, {
    style: function () {
      return {
        color: '#6c7a89',
        weight: 1,
        opacity: 0.9,
        fillColor: '#90caf9',
        fillOpacity: 0.08
      };
    },
    onEachFeature: function (feature, polygonLayer) {
      var p = feature.properties || {};
      var kommunenavn = p.kommunenavn || firstValue(p.navn) || 'Ukjent kommune';
      var kommunenummer = p.kommunenummer || '–';
      polygonLayer.bindPopup(
        '<div class="popup-content">' +
          '<p><strong>Kommune:</strong> ' + escapeHtml(String(kommunenavn)) + '</p>' +
          '<p><strong>Kommunenummer:</strong> ' + escapeHtml(String(kommunenummer)) + '</p>' +
        '</div>'
      );
    }
  });

  fetch('data/kommuner.geojson')
    .then(function (res) {
      if (!res.ok) throw new Error('Kunne ikke laste kommuner.geojson');
      return res.json();
    })
    .then(function (geojson) {
      announceKommunerDataReady(geojson);
      layer.addData(geojson);
    })
    .catch(function () {
      console.warn('Kunne ikke laste kommunegrenser fra data/kommuner.geojson.');
    });

  return layer;
}
