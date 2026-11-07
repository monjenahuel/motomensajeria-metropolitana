import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
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
  timestamp?: string;
  eventType?: string;
  data?: Record<string, unknown>;
}

/**
 * Consumidor de eventos de dominio del broker.
 *
 * Por ahora solo escucha:
 *  - envio.asignado           -> guarda la relación envío ↔ cadete en Redis.
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

  constructor(private readonly tracking: TrackingService) {}

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
      await channel.prefetch(20);

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

    try {
      const evento = JSON.parse(msg.content.toString()) as EventoBroker;
      const routingKey = msg.fields.routingKey || evento.eventType || '';
      await this.aplicarEvento(routingKey, evento);
      channel.ack(msg);
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Broker] Error procesando evento: ${mensaje}`);
      // No reencolar indefinidamente un mensaje inválido.
      channel.nack(msg, false, false);
    }
  }

  private async aplicarEvento(routingKey: string, evento: EventoBroker): Promise<void> {
    const data = evento.data ?? {};
    const envioId = data.envioId ?? data.id;

    if (envioId === undefined || envioId === null) {
      this.logger.warn(`[Broker] Evento ${routingKey} sin envioId. Se descarta.`);
      return;
    }

    const envio = String(envioId);

    if (routingKey === 'envio.asignado') {
      const cadeteId = data.mensajero ?? data.cadeteId;
      if (cadeteId === undefined || cadeteId === null || String(cadeteId).trim() === '') {
        this.logger.warn(`[Broker] Evento envio.asignado sin mensajero/cadeteId (envío ${envio}).`);
        return;
      }
      await this.tracking.asignar(envio, String(cadeteId));
      this.logger.log(`[Broker] EnvioAsignado: envío ${envio} -> cadete ${cadeteId}`);
      return;
    }

    if (routingKey === 'envio.estado_actualizado' || routingKey === 'envio.entregado') {
      const estado = String(data.estadoNuevo ?? data.estado ?? '').toUpperCase();
      // PENDIENTE: el operador liberó la asignación. Los estados finales cierran el envío.
      const libera = routingKey === 'envio.entregado'
        || ['PENDIENTE', 'ENTREGADO', 'NO_ENTREGADO', 'CANCELADO'].includes(estado);

      if (libera) {
        await this.tracking.desasignar(envio);
        this.logger.log(`[Broker] Envío ${envio} sin cadete (${estado || routingKey}). Asignación liberada.`);
      }
    }
  }
}
