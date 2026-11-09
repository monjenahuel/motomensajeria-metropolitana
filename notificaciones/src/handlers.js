// Lógica de Notificaciones, separada del broker y de HTTP para poder probarla sin RabbitMQ.
//
// Eventos que consume:
//   envio.creado, envio.asignado, envio.estado_actualizado  (los publica Envíos)
//   envio.eta_estimado, envio.geocodificacion_fallida        (los publica Mapas)
// El destinatario es data.cliente (el username del cliente, como lo guarda Envíos).
const corto = (id) => String(id).slice(-6); // los ids son UUID: para el aviso alcanza con el final

export function crearNotificaciones({ log = console, max = 1000 } = {}) {
  const lista = [];
  const vistos = new Set(); // eventId ya procesados: un evento reentregado no duplica el aviso
  let secuencia = 0;

  function mensajePara({ tipo, data: d }) {
    const id = corto(d.envioId ?? d.id);
    switch (tipo) {
      case 'envio.creado':
        return `Recibimos tu pedido #${id}. Te avisamos cuando se asigne un cadete.`;
      case 'envio.asignado':
        return `Tu envío #${id} fue asignado a un cadete.`;
      case 'envio.estado_actualizado': {
        const nuevo = String(d.estadoNuevo).toUpperCase();
        const anterior = String(d.estadoAnterior).toUpperCase();
        if (nuevo === 'EN_CAMINO') return `Tu envío #${id} está en camino.`;
        if (nuevo === 'ENTREGADO') return `Tu envío #${id} fue entregado.`;
        if (nuevo === 'NO_ENTREGADO') return `No pudimos entregar tu envío #${id}${d.motivo ? `: ${d.motivo}` : ''}.`;
        if (nuevo === 'CANCELADO') return `Tu envío #${id} fue cancelado.`;
        if (nuevo === 'PENDIENTE' && anterior === 'ASIGNADO') return `Tu envío #${id} volvió a estar pendiente: lo vamos a asignar a otro cadete.`;
        return null;
      }
      case 'envio.eta_estimado':
        return `Tu envío #${id} llegaría en unos ${d.etaMinutos} minutos${d.origenCalculo === 'respaldo' ? ' (estimación aproximada)' : ''}.`;
      case 'envio.geocodificacion_fallida':
        return `No pudimos ubicar una dirección de tu envío #${id}${d.direccion ? ` (${d.direccion})` : ''}. Revisala e intentá de nuevo.`;
      default:
        return null;
    }
  }

  // Procesa un evento; devuelve la notificación creada o null si no corresponde avisar.
  function procesar(env) {
    if (env.eventId && vistos.has(env.eventId)) { log.info(`Evento repetido ignorado: ${env.eventId}`); return null; }
    const mensaje = mensajePara(env);
    if (env.eventId) {
      vistos.add(env.eventId);
      if (vistos.size > 5000) vistos.delete(vistos.values().next().value);
    }
    if (!mensaje) return null;
    if (!env.data?.cliente) { log.warn(`Aviso sin destinatario (evento ${env.eventId})`); return null; }

    const n = {
      id: ++secuencia, eventId: env.eventId, cliente: env.data.cliente,
      envioId: env.data.envioId ?? env.data.id, tipo: env.tipo, mensaje, creadaEn: new Date().toISOString(),
    };
    lista.push(n);
    if (lista.length > max) lista.shift();
    // Canal simulado: un log. Acá se enchufaría un mail, un push o un SMS.
    log.info(`[AVISO -> ${n.cliente}] ${mensaje}`);
    return n;
  }

  // "desde": devuelve solo las notificaciones con id mayor (el frontend puede hacer polling con el último id que vio)
  function listar({ cliente, envioId, desde = 0 } = {}) {
    return lista.filter((n) => n.id > desde
      && (!cliente || n.cliente === cliente)
      && (envioId === undefined || String(n.envioId) === String(envioId)));
  }

  return { procesar, listar };
}
