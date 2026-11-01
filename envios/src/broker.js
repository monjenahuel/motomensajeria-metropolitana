import amqp from 'amqplib';

let channel = null;
let connection = null;

const EXCHANGE_NAME = 'motomensajeria.events';
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

export async function connectBroker(retries = 10, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      connection = await amqp.connect(RABBIT_URL);
      channel = await connection.createChannel();
      
      // Topic Exchange para desacoplamiento y extensibilidad (NFR-2)
      await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
      
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
