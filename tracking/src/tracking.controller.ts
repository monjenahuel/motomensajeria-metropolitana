import { Body, Controller, Get, HttpCode, MessageEvent, NotFoundException, Param, Post, Sse } from '@nestjs/common';
import { Observable, concat, from, interval, map, merge, of, switchMap } from 'rxjs';
import { TrackingService } from './tracking.service';
import { UbicacionDto } from './ubicacion.dto';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  // ---------- Entrada: app del cadete ----------
  @Post('ubicaciones')
  @HttpCode(202)
  async reportar(@Body() dto: UbicacionDto) {
    await this.tracking.registrar(dto);
  }

  // ---------- Consulta puntual (estado actual) ----------
  @Get('cadetes')
  listar() {
    return this.tracking.todas();
  }

  @Get('cadetes/:id/posicion')
  async posicion(@Param('id') id: string) {
    const p = await this.tracking.ultimaPosicion(id);
    if (!p) throw new NotFoundException('Sin posición reciente para ese cadete');
    return p;
  }

  @Get('envios/:envioId/posicion')
  async posicionDeEnvio(@Param('envioId') envioId: string) {
    const cadeteId = await this.tracking.cadeteDeEnvio(envioId);
    if (!cadeteId) throw new NotFoundException('Envío sin cadete asignado');
    return this.posicion(cadeteId);
  }

  // ---------- Salida en vivo (SSE) ----------
  /** Vista del operador: todas las posiciones. */
  @Sse('stream')
  streamTodos(): Observable<MessageEvent> {
    return this.conLatido(this.tracking.stream().pipe(map((p) => ({ data: p }))));
  }

  /** Vista del cliente: solo la posición del cadete que lleva SU envío. Entrega primero la última conocida. */
  @Sse('envios/:envioId/stream')
  streamEnvio(@Param('envioId') envioId: string): Observable<MessageEvent> {
    return from(this.flujoDeEnvio(envioId)).pipe(switchMap((flujo) => flujo));
  }

  private async flujoDeEnvio(envioId: string): Promise<Observable<MessageEvent>> {
    const cadeteId = await this.tracking.cadeteDeEnvio(envioId);
    if (!cadeteId) return of({ type: 'error', data: { mensaje: 'Envío sin cadete asignado' } });
    const ultima = await this.tracking.ultimaPosicion(cadeteId);
    const vivo = this.tracking.stream(cadeteId).pipe(map((p) => ({ data: p })));
    return this.conLatido(ultima ? concat(of({ data: ultima }), vivo) : vivo);
  }

  private conLatido(source: Observable<MessageEvent>): Observable<MessageEvent> {
    // Evento 'ping' cada 15 s para que proxies y balanceadores no cierren la conexión inactiva.
    const latido = interval(15000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent));
    return new Observable<MessageEvent>((sub) => {
      this.tracking.conexionesSse++;
      const s = merge(source, latido).subscribe(sub);
      return () => {
        this.tracking.conexionesSse--;
        s.unsubscribe();
      };
    });
  }

  // ---------- Proyección de asignaciones (solo lectura) ----------
  // Las asignaciones se gestionan en el módulo Operador del MS de Envíos.
  // Tracking solo las recibe por RabbitMQ y las expone para las vistas de la demo.
  @Get('asignaciones')
  asignaciones() {
    return this.tracking.asignaciones();
  }

  // ---------- Métricas para la verificación de NFR ----------
  @Get('metrics')
  metricas() {
    return this.tracking.metricas();
  }
}
