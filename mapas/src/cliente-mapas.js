// Cliente del servicio externo de mapas (en el TP: el mock; en producción: Nominatim/OSRM u otro).
// Es el ÚNICO lugar del sistema que habla con el servicio de mapas, y siempre con caché:
// cada consulta externa se paga (NFR-3).
import { normalizar } from './geo.js';

export function crearClienteMapas({ baseUrl, timeoutMs = 2000, fetchFn = fetch } = {}) {
  const cacheDirecciones = new Map(); // dirección normalizada -> {lat, lon} | null (no encontrada)
  const cacheRutas = new Map();       // "origen;destino" -> segundos
  const stats = { consultasExternas: 0, aciertosCache: 0 };

  async function pedir(path) {
    stats.consultasExternas++;
    const res = await fetchFn(`${baseUrl}${path}`, {
      headers: { 'user-agent': 'motomensajeria-tp-unahur', accept: 'application/json' }, // Nominatim exige identificarse
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`el servicio de mapas respondió ${res.status}`);
    return res.json();
  }

  // Devuelve {lat, lon}, o null si la dirección no existe. Lanza error si el servicio no responde.
  async function geocodificar(direccion) {
    const clave = normalizar(direccion);
    if (cacheDirecciones.has(clave)) { stats.aciertosCache++; return cacheDirecciones.get(clave); }
    const r = await pedir(`/search?q=${encodeURIComponent(direccion)}&format=json&limit=1`);
    const punto = r.length ? { lat: Number(r[0].lat), lon: Number(r[0].lon) } : null;
    cacheDirecciones.set(clave, punto);
    return punto;
  }

  // Duración de la ruta en segundos entre dos puntos {lat, lon}
  async function duracionRutaSeg(a, b) {
    const clave = `${a.lat.toFixed(5)},${a.lon.toFixed(5)};${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
    if (cacheRutas.has(clave)) { stats.aciertosCache++; return cacheRutas.get(clave); }
    const r = await pedir(`/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}`);
    if (r.code !== 'Ok' || !r.routes?.length) throw new Error('el servicio de mapas no devolvió una ruta');
    cacheRutas.set(clave, r.routes[0].duration);
    return r.routes[0].duration;
  }

  return { geocodificar, duracionRutaSeg, stats };
}
