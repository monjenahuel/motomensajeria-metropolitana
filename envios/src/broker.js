import amqp from 'amqplib';

let channel = null;
let connection = null;

// Colas que este servicio consume. Se re-registran solas si el broker se reconecta.
const suscripciones = [];

const EXCHANGE_NAME = process.env.EXCHANGE_NAME;
const RABBIT_URL = process.env.RABBITMQ_URL;

export async function connectBroker(retries = 10, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      connection = await amqp.connect(RABBIT_URL);
      channel = await connection.createChannel();
      
      // Topic Exchange para desacoplamiento y extensibilidad (NFR-2)
      await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
      await channel.prefetch(10);
      await aplicarSuscripciones(channel);

      console.log(`[Broker] Conectado a RabbitMQ en ${RABBIT_URL} (Exchange: ${EXCHANGE_NAME})`);
      
      connection.on('error', (err) => {
        console.error('[Broker] Error de conexión:', err.message);
      });
      
      connection.on('close', () => {
        console.warn('[Broker] Conexión cerrada. Reintentando reconexión...');
        channel = null;
        setTimeout(() => connectBroker(5, 3000), 3000);
      });

      return;
    } catch (err) {
      console.warn(`[Broker] Intento ${i + 1}/${retries} falló conectando a RabbitMQ. Reintentando en ${delay / 1000}s...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  console.error('[Broker] No se pudo conectar a RabbitMQ tras varios reintentos. Operando en modo degradado.');
}

async function procesarMensaje(ch, handler, msg) {
  if (!msg) return;
  let evento;
  try {
    evento = JSON.parse(msg.content.toString());
  } catch {
    console.error('[Broker] Mensaje descartado: JSON inválido');
    return ch.ack(msg);
  }

  const tipo = msg.fields.routingKey || evento.eventType;
  try {
    await handler({ eventId: evento.eventId, tipo, data: evento.data ?? {} });
    ch.ack(msg);
  } catch (err) {
    // Un reintento; si vuelve a fallar se descarta para no trabar la cola con un mensaje venenoso.
    if (!msg.fields.redelivered) {
      console.warn(`[Broker] Error procesando ${tipo}, se reintenta una vez: ${err.message}`);
      ch.nack(msg, false, true);
    } else {
      console.error(`[Broker] Mensaje descartado tras reintento (${tipo}): ${err.message}`);
      ch.ack(msg);
    }
  }
}

async function registrarSuscripcion({ cola, tipos, handler }, ch = channel) {
  if (!ch) return;
  await ch.assertQueue(cola, { durable: true });
  for (const tipo of tipos) await ch.bindQueue(cola, EXCHANGE_NAME, tipo);
  await ch.consume(cola, (msg) => procesarMensaje(ch, handler, msg));
  console.log(`[Broker] Consumiendo ${cola} (${tipos.join(', ')})`);
}

async function aplicarSuscripciones(ch) {
  for (const suscripcion of suscripciones) await registrarSuscripcion(suscripcion, ch);
}

/**
 * Consume eventos de una cola durable. La suscripción se vuelve a registrar si el broker se reconecta.
 * @param {string} cola - Ej: 'envios.geocodificacion'
 * @param {string[]} tipos - Routing keys a escuchar
 * @param {(evento: {eventId: string, tipo: string, data: object}) => Promise<void>} handler
 */
export async function suscribir(cola, tipos, handler) {
  const suscripcion = { cola, tipos, handler };
  suscripciones.push(suscripcion);
  await registrarSuscripcion(suscripcion);
}

/**
 * Publica un evento de dominio al topic exchange
 * @param {string} routingKey - Ej: 'envio.creado', 'envio.asignado', 'envio.estado_actualizado'
 * @param {object} payload - Contenido del evento
 */
export async function publishEvent(routingKey, payload) {
  if (!channel) {
    console.warn(`[Broker] Mensaje no publicado (${routingKey}): canal de RabbitMQ no disponible.`);
    return false;
  }

  const message = {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    eventType: routingKey,
    data: payload,
  };

  const buffer = Buffer.from(JSON.stringify(message));
  channel.publish(EXCHANGE_NAME, routingKey, buffer, { persistent: true });
  console.log(`[Broker Evento Publicado] ${routingKey} - Envio ID: ${payload.id || payload.envioId}`);
  return true;
}
