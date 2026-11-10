import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { DatabaseService } from './database.service';
import { TrackingService } from './tracking.service';

/**
 * Configuración obligatoria: si falta una variable (o está vacía), el servicio
 * no arranca. Evita conexiones silenciosas a valores por defecto no deseados.
 */
function requerida(nombre: string): string {
  const valor = process.env[nombre]?.trim();
  if (!valor) {
    throw new Error(`[Broker] Falta la variable de entorno obligatoria ${nombre}. Tracking no puede iniciar.`);
  }
  return valor;
}

const RABBIT_URL = requerida('RABBITMQ_URL');
const EXCHANGE = requerida('RABBITMQ_EXCHANGE');
const QUEUE = requerida('RABBITMQ_QUEUE');

const RECONNECT_MS = Number(process.env.RABBITMQ_RECONNECT_MS ?? 3000);
const ROUTING_KEYS = (process.env.RABBITMQ_ROUTING_KEYS ?? 'envio.asignado,envio.estado_actualizado,envio.entregado')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);

interface EventoBroker {
  eventId?: string;
  data?: Record<string, unknown>;
}

/**
 * Consumidor de eventos de dominio del broker.
 *
 * Por ahora solo escucha:
 *  - envio.asignado           -> guarda la relación envío ↔ cadete en PostgreSQL.
 *  - envio.estado_actualizado -> libera la asignación si el envío vuelve a
 *                                PENDIENTE o finaliza (ENTREGADO/NO_ENTREGADO/CANCELADO).
 *  - envio.entregado          -> idem, por si en el futuro se emite como evento propio.
 *
 * La publicación de eventos queda fuera de este microservicio.
 */
@Injectable()
export class RabbitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private connection?: ChannelModel;
  private channel?: Channel;
  private reconnectTimer?: NodeJS.Timeout;
  private cerrando = false;

  constructor(private readonly db: DatabaseService, private readonly tracking: TrackingService) {}

  onModuleInit() {
    // No bloquea el arranque de Tracking si RabbitMQ tarda en estar disponible.
    void this.conectar();
  }

  async onModuleDestroy() {
    this.cerrando = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      await this.channel?.close();
    } catch {}
    try {
      await this.connection?.close();
    } catch {}
  }

  private async conectar(): Promise<void> {
    if (this.cerrando) return;

    try {
      const connection = await amqp.connect(RABBIT_URL);
      this.connection = connection;

      connection.on('error', (err) => {
        this.logger.error(`[Broker] Error de conexión: ${err.message}`);
      });

      connection.on('close', () => {
        if (this.connection !== connection) return;
        this.connection = undefined;
        this.channel = undefined;
        this.logger.warn('[Broker] Conexión cerrada. Reintentando...');
        this.programarReconexion();
      });

      const channel = await connection.createChannel();
      this.channel = channel;

      channel.on('error', (err) => {
        this.logger.error(`[Broker] Error de canal: ${err.message}`);
      });

      channel.on('close', () => {
        if (this.cerrando || this.channel !== channel) return;
        this.channel = undefined;
        this.logger.warn('[Broker] Canal cerrado. Reintentando...');
        void this.connection?.close().catch(() => {});
        this.programarReconexion();
      });

      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue(QUEUE, { durable: true });
      for (const routingKey of ROUTING_KEYS) {
        await channel.bindQueue(QUEUE, EXCHANGE, routingKey);
      }
      // Evitar procesar eventos concurrentemente en este consumidor.
      await channel.prefetch(1);

      await channel.consume(
        QUEUE,
        (msg) => void this.procesar(msg, channel),
        { noAck: false },
      );

      this.logger.log(
        `[Broker] Escuchando ${ROUTING_KEYS.join(', ')} en ${EXCHANGE} (cola: ${QUEUE})`,
      );
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Broker] No se pudo conectar a RabbitMQ: ${mensaje}. Reintentando en ${RECONNECT_MS} ms...`);
      this.programarReconexion();
    }
  }

  private programarReconexion(): void {
    if (this.cerrando || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.conectar();
    }, RECONNECT_MS);
  }

  private async procesar(msg: ConsumeMessage | null, channel: Channel): Promise<void> {
    if (!msg) return;
    let evento: EventoBroker;
    try {
      evento = JSON.parse(msg.content.toString()) as EventoBroker;
    } catch (err) {
      this.logger.warn('[Broker] JSON inválido. Se descarta.');
      channel.nack(msg, false, false);
      return;
    }
    const routingKey = msg.fields.routingKey;
    const data = evento?.data;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const envioId = data?.envioId ?? data?.id;
    const cadeteId = data?.mensajero ?? data?.cadeteId;
    if (!['envio.asignado', 'envio.estado_actualizado', 'envio.entregado'].includes(routingKey)
      || !evento?.eventId || !uuid.test(evento.eventId)
      || typeof envioId !== 'string' || !uuid.test(envioId)
      || (routingKey === 'envio.asignado' && (typeof cadeteId !== 'string' || !cadeteId.trim()))) {
      this.logger.warn(`[Broker] Evento ${routingKey} incompleto o inválido. Se descarta.`);
      channel.nack(msg, false, false);
      return;
    }
    try {
      await this.db.aplicarEvento(evento.eventId, routingKey, data!);
      const estado = String(data!.estadoNuevo ?? data!.estado ?? (routingKey === 'envio.entregado' ? 'ENTREGADO' : '')).toUpperCase();
      if (routingKey !== 'envio.asignado' && ['PENDIENTE', 'ENTREGADO', 'NO_ENTREGADO', 'CANCELADO'].includes(estado)) {
        // También se publica en redeliveries: el commit pudo ocurrir antes de fallar Redis.
        await this.tracking.publicarFinDeEnvio(envioId as string, estado);
      }
      channel.ack(msg); // solo después del COMMIT (incluida la deduplicación)
    } catch (err) {
      this.logger.error(`[Broker] Fallo de persistencia; se reintentará: ${err instanceof Error ? err.message : err}`);
      // Un fallo temporal de PostgreSQL no debe mandar el evento a la DLQ.
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
      try { channel.nack(msg, false, true); } catch { /* el cierre del canal lo reencola */ }
    }
  }
}
