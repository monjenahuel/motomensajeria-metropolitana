// Cliente mínimo de RabbitMQ. Mismo archivo en mapas y notificaciones.
// Usa el MISMO exchange y el MISMO formato de mensaje que el servicio de Envíos:
//   exchange (topic, durable) = EXCHANGE_NAME      mensaje = { eventId, timestamp, eventType, data }
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export async function conectarBroker({ url, exchange, intentos = 20, esperaMs = 3000, log = console }) {
  let conn;
  for (let i = 1; i <= intentos; i++) {
    try { conn = await amqp.connect(url); break; }
    catch (e) {
      log.warn(`Broker no disponible (intento ${i}/${intentos}): ${e.message}`);
      if (i === intentos) throw e;
      await dormir(esperaMs);
    }
  }
  conn.on('error', (e) => log.error('Error de conexión con el broker:', e.message));
  // Si se corta la conexión, el proceso termina y Docker lo reinicia (restart: unless-stopped).
  conn.on('close', () => { log.error('Conexión con el broker cerrada: el proceso se reinicia'); process.exit(1); });

  const canal = await conn.createChannel();
  await canal.assertExchange(exchange, 'topic', { durable: true });

  // Publica un evento. La routing key es el eventType.
  async function publicar(eventType, data) {
    const mensaje = { eventId: randomUUID(), timestamp: new Date().toISOString(), eventType, data };
    canal.publish(exchange, eventType, Buffer.from(JSON.stringify(mensaje)), {
      persistent: true, contentType: 'application/json', messageId: mensaje.eventId,
    });
    return mensaje;
  }

  // Cola durable con ack manual: si el servicio se cae, los eventos esperan en la cola.
  // El handler recibe { eventId, tipo, data }.
  async function suscribir(cola, tipos, handler) {
    await canal.assertQueue(cola, { durable: true });
    for (const t of tipos) await canal.bindQueue(cola, exchange, t);
    await canal.prefetch(10);
    await canal.consume(cola, async (msg) => {
      if (!msg) return;
      let evento;
      try { evento = JSON.parse(msg.content.toString()); }
      catch { log.error('Mensaje descartado: JSON inválido'); return canal.ack(msg); }
      const tipo = msg.fields.routingKey || evento.eventType;
      try { await handler({ eventId: evento.eventId, tipo, data: evento.data ?? {} }); canal.ack(msg); }
      catch (e) {
        // Un reintento; si vuelve a fallar se descarta para no trabar la cola con un mensaje venenoso.
        if (!msg.fields.redelivered) {
          log.warn(`Error procesando ${tipo}, se reintenta una vez: ${e.message}`);
          canal.nack(msg, false, true);
        } else {
          log.error(`Mensaje descartado tras reintento (${tipo}): ${e.message}`);
          canal.ack(msg);
        }
      }
    });
  }

  return { publicar, suscribir };
}
