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
      window.nodhavnGeoJSON = geojson;
      layer.addData(geojson);
    })
    .catch(function (err) {
      fetch('data/nodhavn.geojson')
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('Kunne ikke laste GeoJSON')); })
        .then(function (geojson) {
          window.nodhavnGeoJSON = geojson;
          layer.addData(geojson);
        })
        .catch(function () {
          console.warn('Kunne ikke laste nødhavn (verken Supabase eller lokal fil).');
        });
    });

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
      layer.addData(geojson);
    })
    .catch(function () {
      console.warn('Kunne ikke laste kommunegrenser fra data/kommuner.geojson.');
    });

  return layer;
}
