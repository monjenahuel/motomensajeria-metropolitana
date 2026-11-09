// Lógica del servicio de Mapas, separada del broker para poder probarla sin RabbitMQ.
//
// Eventos que consume (los publica Envíos):
//   envio.creado             data = fila del envío: { id, cliente, origen (texto), destino (texto), lat_origen, ... }
//   envio.asignado           data = { envioId, cliente, mensajero, ... }
//   envio.estado_actualizado data = { envioId, cliente, mensajero, estadoAnterior, estadoNuevo, ... }
// Eventos que publica:
//   envio.geocodificado, envio.geocodificacion_fallida, envio.eta_estimado
import { haversineKm } from './geo.js';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Postgres devuelve NUMERIC como texto ("-34.6037000"); null/'' significa "sin coordenada"
function punto(lat, lon) {
  if (lat == null || lon == null) return null;
  const latTexto = String(lat).trim();
  const lonTexto = String(lon).trim();
  if (latTexto === '' || lonTexto === '') return null;
  const p = { lat: Number(latTexto), lon: Number(lonTexto) };
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;
}

export function crearHandlers({
  mapas, publicar, log = console,
  retiroMin = 10,              // minutos que se suman al ETA mientras el cadete va a retirar
  velocidadRespaldoKmh = 25,   // para el cálculo propio cuando el servicio de mapas no responde
  reintentos = 3, esperaMs = 500, maxEnvios = 5000,
}) {
  const vistos = new Set();    // eventId ya procesados: un evento reentregado no genera consultas ni eventos duplicados
  const envios = new Map();    // envioId -> { cliente, origen: {lat, lon}, destino: {lat, lon} } (memoria: se pierde al reiniciar)

  const recordar = (envioId, info) => {
    envios.delete(envioId); envios.set(envioId, info);
    if (envios.size > maxEnvios) envios.delete(envios.keys().next().value);
  };

  const unaVez = (fn) => async (env) => {
    if (env.eventId && vistos.has(env.eventId)) { log.info(`Evento repetido ignorado: ${env.eventId}`); return; }
    // Se marca ANTES del await para que dos entregas concurrentes del mismo evento no lo procesen dos veces.
    if (env.eventId) {
      vistos.add(env.eventId);
      if (vistos.size > 5000) vistos.delete(vistos.values().next().value);
    }
    try {
      await fn(env);
    } catch (e) {
      // Si falla, se libera para que la reentrega del broker pueda reintentarlo.
      if (env.eventId) vistos.delete(env.eventId);
      throw e;
    }
  };

  async function conReintentos(fn) {
    let ultimo;
    for (let i = 0; i < reintentos; i++) {
      try { return await fn(); } catch (e) {
        ultimo = e;
        if (i < reintentos - 1) await dormir(esperaMs * 2 ** i);
      }
    }
    throw ultimo;
  }

  // envio.creado -> ubica origen y destino -> envio.geocodificado | envio.geocodificacion_fallida
  async function envioCreado({ data }) {
    const envioId = String(data.id ?? data.envioId);
    const cliente = data.cliente;
    const po = punto(data.lat_origen, data.lon_origen);
    const pd = punto(data.lat_destino, data.lon_destino);
    const origen = typeof data.origen === 'string' ? data.origen.trim() : '';
    const destino = typeof data.destino === 'string' ? data.destino.trim() : '';
    // Sin coordenadas y sin dirección no hay nada que ubicar: se evita gastar consultas en un texto vacío.
    if ((!po && !origen) || (!pd && !destino)) {
      return await publicar('envio.geocodificacion_fallida', {
        envioId, cliente, motivo: 'direccion_vacia', direccion: !po ? origen || null : destino || null,
      });
    }
    try {
      // Si el envío ya trae coordenadas no se paga ninguna consulta.
      const [o, d] = await Promise.all([
        po ?? conReintentos(() => mapas.geocodificar(origen)),
        pd ?? conReintentos(() => mapas.geocodificar(destino)),
      ]);
      if (!o || !d) {
        return await publicar('envio.geocodificacion_fallida', {
          envioId, cliente, motivo: 'direccion_no_encontrada', direccion: !o ? origen : destino,
        });
      }
      recordar(envioId, { cliente, origen: o, destino: d });
      if (po && pd) { log.info(`Envío ${envioId}: ya traía coordenadas, no se consultó al servicio de mapas`); return; }
      await publicar('envio.geocodificado', {
        envioId, cliente,
        origen: { direccion: origen, ...o },
        destino: { direccion: destino, ...d },
      });
    } catch (e) {
      log.error(`No se pudo geocodificar el envío ${envioId}: ${e.message}`);
      await publicar('envio.geocodificacion_fallida', {
        envioId, cliente, motivo: 'servicio_de_mapas_no_disponible', direccion: null,
      });
    }
  }

  // envio.asignado y envio.estado_actualizado (a EN_CAMINO) -> envio.eta_estimado
  async function estimarEta({ tipo, data }) {
    const envioId = String(data.envioId ?? data.id);
    if (tipo === 'envio.estado_actualizado' && String(data.estadoNuevo).toUpperCase() !== 'EN_CAMINO') return;

    let info = envios.get(envioId);
    // Si Mapas se reinició perdió su memoria. Si el evento trae las direcciones (opcional), se vuelven a ubicar.
    if (!info && typeof data.origen === 'string' && typeof data.destino === 'string') {
      try {
        const o = await mapas.geocodificar(data.origen);
        const d = await mapas.geocodificar(data.destino);
        if (o && d) { info = { cliente: data.cliente, origen: o, destino: d }; recordar(envioId, info); }
      } catch (e) { log.warn(`No se pudieron ubicar las direcciones del envío ${envioId}: ${e.message}`); }
    }
    if (!info) { log.warn(`ETA omitido (envío ${envioId}): no se conocen sus coordenadas (¿Mapas se reinició?)`); return; }

    let segundos; let origenCalculo = 'mapas';
    try { segundos = await mapas.duracionRutaSeg(info.origen, info.destino); } catch (e) {
      log.warn(`Servicio de mapas caído, se usa estimación de respaldo (envío ${envioId}): ${e.message}`);
      origenCalculo = 'respaldo';
      segundos = ((haversineKm(info.origen, info.destino) * 1.3) / velocidadRespaldoKmh) * 3600;
    }
    const etaMinutos = Math.ceil(segundos / 60) + (tipo === 'envio.asignado' ? retiroMin : 0);
    await publicar('envio.eta_estimado', { envioId, cliente: data.cliente ?? info.cliente, etaMinutos, origenCalculo });
  }

  // Clave = tipo de evento al que se suscribe el servicio
  return {
    'envio.creado': unaVez(envioCreado),
    'envio.asignado': unaVez(estimarEta),
    'envio.estado_actualizado': unaVez(estimarEta),
  };
}
