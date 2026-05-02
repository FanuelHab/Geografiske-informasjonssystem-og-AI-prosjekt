# Data Directory

This directory is reserved for GeoJSON data files and other geospatial data.

## Usage

Place your GeoJSON files here for easy integration with the map application.

Example structure:
```
data/
  ├── points.geojson
  ├── lines.geojson
  └── polygons.geojson
```

## Loading GeoJSON Data

To load GeoJSON data in your application, you can use a pattern like this (see `assets/js/layers.js` for the full integration):

```javascript
// Example: Loading a GeoJSON file
fetch('data/your-data.geojson')
    .then(response => response.json())
    .then(data => {
        L.geoJSON(data, {
            onEachFeature: function(feature, layer) {
                if (feature.properties && feature.properties.name) {
                    layer.bindPopup(feature.properties.name);
                }
            }
        }).addTo(map);
    })
    .catch(error => console.error('Error loading GeoJSON:', error));
```

## External API Integration

This structure also supports loading data from external APIs. Simply replace the `fetch` URL with your API endpoint.
