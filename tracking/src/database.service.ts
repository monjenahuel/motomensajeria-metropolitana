import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export interface Asignacion { envioId: string; cadeteId: string }

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.TRACKING_DB_HOST ?? 'tracking-db',
    port: Number(process.env.TRACKING_DB_PORT ?? 5432),
    database: process.env.TRACKING_DB_NAME ?? 'tracking',
    user: process.env.TRACKING_DB_USER ?? 'tracking',
    password: process.env.TRACKING_DB_PASSWORD,
  });

  async onModuleDestroy() { await this.pool.end(); }

  async cadeteDeEnvio(envioId: string): Promise<string | null> {
    const { rows } = await this.pool.query('SELECT cadete_id FROM asignaciones WHERE envio_id = $1', [envioId]);
    return rows[0]?.cadete_id ?? null;
  }

  async asignaciones(): Promise<Asignacion[]> {
    const { rows } = await this.pool.query('SELECT envio_id AS "envioId", cadete_id AS "cadeteId" FROM asignaciones ORDER BY envio_id');
    return rows;
  }

  /** Una transacción para el evento y su marca de idempotencia. El consumidor ACKea tras COMMIT. */
  async aplicarEvento(eventId: string, routingKey: string, data: Record<string, unknown>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        'INSERT INTO eventos_procesados (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [eventId]
      );
      if (!rowCount) {
        await client.query('COMMIT');
        return false;
      }

      const envioId = String(data.envioId ?? data.id);
      if (routingKey === 'envio.asignado') {
        await client.query(
          `INSERT INTO asignaciones (envio_id, cadete_id) VALUES ($1, $2)
           ON CONFLICT (envio_id) DO UPDATE SET cadete_id = EXCLUDED.cadete_id, actualizado_en = now()`,
          [envioId, String(data.mensajero ?? data.cadeteId)]
        );
      } else {
        const estado = String(data.estadoNuevo ?? data.estado ?? '').toUpperCase();
        if (routingKey === 'envio.entregado' || ['PENDIENTE', 'ENTREGADO', 'NO_ENTREGADO', 'CANCELADO'].includes(estado)) {
          await client.query('DELETE FROM asignaciones WHERE envio_id = $1', [envioId]);
        }
      }
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Snapshot completo solo en segundo plano. Las lecturas de mapas nunca dependen de Envíos. */
  async reconciliar(actuales: Asignacion[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM asignaciones WHERE NOT (envio_id = ANY($1::uuid[]))', [actuales.map((a) => a.envioId)]);
      for (const { envioId, cadeteId } of actuales) {
        await client.query(
          `INSERT INTO asignaciones (envio_id, cadete_id) VALUES ($1, $2)
           ON CONFLICT (envio_id) DO UPDATE SET cadete_id = EXCLUDED.cadete_id, actualizado_en = now()
           WHERE asignaciones.cadete_id IS DISTINCT FROM EXCLUDED.cadete_id`,
          [envioId, cadeteId]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
