import { Injectable, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';
import { RedisService } from './redis.service';
import { UbicacionDto } from './ubicacion.dto';

export interface Posicion {
  cadeteId: string;
  lat: number;
  lng: number;
  ts: number; // hora del GPS (ms)
  recibidoEn: number; // hora en que Tracking la recibió (ms)
  rumbo?: number;
}

const CHANNEL = 'tracking:posiciones';
const POS_TTL_S = Number(process.env.POS_TTL_S ?? 30); // sin reportes -> la posición expira sola

@Injectable()
export class TrackingService implements OnModuleInit {
  /** Fan-out interno: cada posición que llega por Redis Pub/Sub se reparte a los clientes SSE de ESTA instancia. */
  private readonly posiciones$ = new Subject<Posicion>();

  // --- métricas (para verificar los NFR con números) ---
  private latencias: number[] = [];
  private recibidos = 0;
  private ventana: number[] = [];
  conexionesSse = 0;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    await this.redis.sub.subscribe(CHANNEL);
    this.redis.sub.on('message', (_canal, msg) => {
      const p: Posicion = JSON.parse(msg);
      // latencia interna: recepción del POST -> entrega al fan-out SSE
      this.latencias.push(Date.now() - p.recibidoEn);
      if (this.latencias.length > 2000) this.latencias.shift();
      this.posiciones$.next(p);
    });
  }

  /** POST del cadete: guarda la última posición (con TTL) y la publica, en una sola operación atómica. */
  async registrar(dto: UbicacionDto): Promise<void> {
    const ahora = Date.now();
    const p: Posicion = { ...dto, ts: dto.ts ?? ahora, recibidoEn: ahora };
    const payload = JSON.stringify(p);
    await this.redis.cmd
      .multi()
      .set(`pos:${p.cadeteId}`, payload, 'EX', POS_TTL_S)
      .publish(CHANNEL, payload)
      .exec();
    this.recibidos++;
    this.ventana.push(ahora);
  }

  async ultimaPosicion(cadeteId: string): Promise<Posicion | null> {
    const raw = await this.redis.cmd.get(`pos:${cadeteId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async todas(): Promise<Posicion[]> {
    const claves: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.cmd.scan(cursor, 'MATCH', 'pos:*', 'COUNT', 500);
      cursor = next;
      claves.push(...batch);
    } while (cursor !== '0');
    if (!claves.length) return [];
    const valores = await this.redis.cmd.mget(claves);
    return valores.filter((v): v is string => !!v).map((v) => JSON.parse(v));
  }

  /** Flujo en vivo de todas las posiciones (vista del operador) o de un solo cadete (seguimiento de un envío). */
  stream(cadeteId?: string): Observable<Posicion> {
    return cadeteId ? this.posiciones$.pipe(filter((p) => p.cadeteId === cadeteId)) : this.posiciones$.asObservable();
  }

  // --- Asignaciones: proyección de solo lectura de los eventos del broker ---
  // El alta/baja real vive en el módulo Operador del MS de Envíos (PostgreSQL + eventos).
  async asignar(envioId: string, cadeteId: string) {
    await this.redis.cmd.set(`asig:${envioId}`, cadeteId);
  }
  async desasignar(envioId: string) {
    await this.redis.cmd.del(`asig:${envioId}`);
  }
  async cadeteDeEnvio(envioId: string): Promise<string | null> {
    return this.redis.cmd.get(`asig:${envioId}`);
  }
  async asignaciones(): Promise<{ envioId: string; cadeteId: string }[]> {
    const claves: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.cmd.scan(cursor, 'MATCH', 'asig:*', 'COUNT', 1000);
      cursor = next;
      claves.push(...batch);
    } while (cursor !== '0');
    if (!claves.length) return [];
    const valores = await this.redis.cmd.mget(claves);
    return claves.map((k, i) => ({ envioId: k.slice(5), cadeteId: valores[i] ?? '' }));
  }

  async metricas() {
    const ahora = Date.now();
    this.ventana = this.ventana.filter((t) => ahora - t < 5000);
    const ord = [...this.latencias].sort((a, b) => a - b);
    const pct = (q: number) => (ord.length ? ord[Math.min(ord.length - 1, Math.floor(q * ord.length))] : null);
    return {
      cadetesConPosicion: (await this.todas()).length,
      posicionTtlS: POS_TTL_S,
      reportesPorSegundo: Number((this.ventana.length / 5).toFixed(1)),
      reportesTotales: this.recibidos,
      conexionesSse: this.conexionesSse,
      latenciaInternaMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), muestras: ord.length },
    };
  }
}
