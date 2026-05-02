/**
 * Statisk utviklingsserver for prosjektroten (Leaflet + fetch til GeoJSON).
 * CORS er satt slik at siden kan åpnes fra Live Server på annen lokal port.
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PORT = Number(process.env.PORT) || 3000;

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  const reqHdr = req.headers['access-control-request-headers'];
  res.setHeader('Access-Control-Allow-Headers', reqHdr || 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log(`App: http://127.0.0.1:${PORT}`);
});
