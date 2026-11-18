// Mock del servicio externo de mapas (geocodificación + rutas).
// Imita el formato de Nominatim (/search) y de OSRM (/route/v1/driving), los servicios de OpenStreetMap,
// para que el adaptador pueda apuntar al servicio real cambiando solo la URL.
// Lleva un contador de consultas (el servicio real cobra por consulta) y un modo falla para simular una caída.
import http from 'node:http';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export const normalizar = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Coordenadas aproximadas de las direcciones de ejemplo del TP.
const CONOCIDAS = new Map([
  ['Av. Corrientes 1000, CABA', [-34.6039, -58.3790]],
  ['Av. Cabildo 2000, CABA', [-34.5617, -58.4546]],
  ['Av. Rivadavia 5000, CABA', [-34.6160, -58.4330]],
  ['Calle Mitre 300, Avellaneda', [-34.6627, -58.3653]],
  ['Av. Santa Fe 2500, CABA', [-34.5953, -58.4001]],
  ['Av. Maipú 1500, Vicente López', [-34.5290, -58.4766]],
  ['Av. Rivadavia 1234, CABA', [-34.6093, -58.3900]],
  ['Mitre 456, Avellaneda', [-34.6610, -58.3640]],
].map(([dir, p]) => [normalizar(dir), p]));

const hash = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};

// null = "dirección no encontrada" (cualquier dirección que contenga "inexistente")
function ubicar(direccion) {
  const n = normalizar(direccion);
  if (n === '' || n.includes('inexistente')) return null;
  if (CONOCIDAS.has(n)) return CONOCIDAS.get(n);
  // Fuera de la lista: punto determinista dentro del AMBA (la misma dirección da siempre el mismo punto).
  const lat = -34.72 + ((hash(n) % 10000) / 10000) * 0.20;
  const lon = -58.55 + ((hash(`${n}#`) % 10000) / 10000) * 0.22;
  return [lat, lon];
}

const rad = (g) => (g * Math.PI) / 180;
function distanciaKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const RUTA = /^\/route\/v1\/driving\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

export function crearMock({ latenciaMs = 150, velocidadKmh = 25, falla = false } = {}) {
  const estado = { falla, consultas: { geocode: 0, route: 0, fallidas: 0 } };

  const responder = (res, status, cuerpo) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  };
  const leerJson = (req) => new Promise((ok) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const ruta = url.pathname;
    const { geocode, route, fallidas } = estado.consultas;

    if (req.method === 'GET' && ruta === '/health') return responder(res, 200, { status: 'ok', service: 'mock-mapas' });

    // --- Contador y modo falla (para la demo y la verificación de NFRs) ---
    if (req.method === 'GET' && ruta === '/stats') {
      return responder(res, 200, { consultas: { total: geocode + route, geocode, route, fallidas }, falla: estado.falla });
    }
    if (req.method === 'POST' && ruta === '/stats/reset') {
      estado.consultas = { geocode: 0, route: 0, fallidas: 0 };
      return responder(res, 200, { ok: true });
    }
    if (ruta === '/admin/falla') {
      if (req.method === 'POST') {
        const { activo } = await leerJson(req);
        // Solo un boolean explícito cambia el modo falla (evita que "false" se interprete como true).
        if (typeof activo !== 'boolean') {
          return responder(res, 400, { error: 'el campo "activo" debe ser boolean' });
        }
        estado.falla = activo;
      }
      return responder(res, 200, { activo: estado.falla });
    }

    // --- Geocodificación (formato Nominatim) ---
    if (req.method === 'GET' && ruta === '/search') {
      if (estado.falla) { estado.consultas.fallidas++; return responder(res, 503, { error: 'servicio de mapas no disponible (simulado)' }); }
      await dormir(latenciaMs);
      estado.consultas.geocode++;
      const q = url.searchParams.get('q') ?? '';
      const p = ubicar(q);
      return responder(res, 200, p ? [{ place_id: hash(q), lat: p[0].toFixed(6), lon: p[1].toFixed(6), display_name: q }] : []);
    }

    // --- Rutas (formato OSRM: lon,lat;lon,lat) ---
    const m = ruta.match(RUTA);
    if (req.method === 'GET' && m) {
      if (estado.falla) { estado.consultas.fallidas++; return responder(res, 503, { code: 'Unavailable' }); }
      await dormir(latenciaMs);
      estado.consultas.route++;
      const [lon1, lat1, lon2, lat2] = m.slice(1).map(Number);
      const metros = distanciaKm(lat1, lon1, lat2, lon2) * 1.3 * 1000; // 1,3 = rodeo urbano
      return responder(res, 200, {
        code: 'Ok',
        routes: [{ distance: Math.round(metros), duration: Math.round(metros / (velocidadKmh / 3.6)) }],
      });
    }

    responder(res, 404, { error: 'ruta no encontrada' });
  });

  server.estado = estado;
  return server;
}
