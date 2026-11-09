import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Asignacion, DatabaseService } from './database.service';

const ENVIOS_URL = (process.env.ENVIOS_INTERNAL_URL ?? 'http://envios:3000').replace(/\/+$/, '');
const SECRET = process.env.TRACKING_SYNC_SECRET;
if (!SECRET) throw new Error('Falta TRACKING_SYNC_SECRET para reconciliar asignaciones.');
const INTERVALO_MS = 60_000;

/** Anti-entropía: snapshot al iniciar y periódicamente, nunca durante una lectura del mapa. */
@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private timer?: NodeJS.Timeout;
  private ejecutando = false;

  constructor(private readonly db: DatabaseService) {}

  onModuleInit() {
    void this.reconciliar();
    this.timer = setInterval(() => void this.reconciliar(), INTERVALO_MS);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async reconciliar(): Promise<void> {
    if (this.ejecutando) return;
    this.ejecutando = true;
    try {
      const respuesta = await fetch(`${ENVIOS_URL}/internal/tracking/asignaciones`, {
        headers: { 'x-tracking-sync-secret': SECRET! },
        signal: AbortSignal.timeout(5000),
      });
      if (!respuesta.ok) throw new Error(`Envíos respondió ${respuesta.status}`);
      const actuales: unknown = await respuesta.json();
      if (!Array.isArray(actuales) || actuales.some((a) =>
        typeof a.envioId !== 'string' || typeof a.cadeteId !== 'string' || !a.cadeteId)) {
        throw new Error('Snapshot de asignaciones inválido');
      }
      await this.db.reconciliar(actuales as Asignacion[]);
      this.logger.log(`Proyección sincronizada con Envíos: ${actuales.length} asignaciones vigentes.`);
    } catch (err) {
      this.logger.warn(`Reconciliación pendiente; se conserva la proyección local: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.ejecutando = false;
    }
  }
}
