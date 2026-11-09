# Microservicio de Tracking

Tracking en tiempo real del escenario 3B: **NestJS + PostgreSQL propio + Redis + SSE + RabbitMQ**. PostgreSQL guarda la proyección de asignaciones; Redis guarda posiciones GPS temporales y distribuye actualizaciones en vivo.

## Acceso

Con el stack completo levantado (`docker compose up -d --build`):

- **Operador:** http://localhost:3002 — todos los cadetes en el mapa, métricas y seguimiento por envío.
- **Cliente:** http://localhost:3002/cliente.html?envio=01a1a901-5800-7000-8000-000000000001 — solo el canal SSE de ese envío. Requiere que el envío esté asignado desde el módulo Operador del MS de Envíos.
- **Métricas:** http://localhost:3002/tracking/metrics

El contenedor escucha internamente en `3000`; el host publica en `3002` (`TRACKING_PORT`) para no chocar con el API Gateway.

## Flujo

```
App cadete ──Bearer + GPS──▶ Gateway ──cadeteId del token──▶ Tracking MS ──SET (TTL) + PUBLISH──▶ Redis
                                                ▲                                  │
                                                └────── Pub/Sub (todas las instancias)
Cliente ◀──SSE /tracking/envios/:id/stream── Tracking MS     Operador ◀──SSE /tracking/stream
```

## Eventos de RabbitMQ

Tracking se conecta al broker y consume del exchange `motomensajeria.events` con una cola durable `tracking.envios`:

| Evento | Acción |
|---|---|
| `envio.asignado` | Guarda `envioId` → `mensajero` en PostgreSQL de Tracking |
| `envio.estado_actualizado` (`PENDIENTE`, `ENTREGADO`, `NO_ENTREGADO`, `CANCELADO`) | Elimina la asignación del envío |
| `envio.entregado` | Elimina la asignación del envío |

La fuente de verdad de las asignaciones es Envíos. Tracking mantiene una **proyección durable propia** en `tracking-db`, con una tabla inbox `eventos_procesados` para deduplicar `eventId`. Confirma los eventos de RabbitMQ **después** del commit; si PostgreSQL falla, reencola el evento. Al iniciar y cada 60 segundos, una tarea en segundo plano consulta el snapshot de Envíos mediante `TRACKING_SYNC_SECRET` y reconcilia la proyección para cubrir eventos perdidos. Si Envíos no está disponible, conserva la proyección local y vuelve a intentarlo. **Abrir mapas y consultar asignaciones no llama a Envíos**; la corrección tras un evento perdido es eventual (hasta la siguiente reconciliación). Sin outbox en Envíos, no hay garantía de publicación atómica con su transacción.

La conexión se reintenta automáticamente y el arranque de Tracking no depende de que RabbitMQ esté disponible en ese instante. **Por ahora solo consume eventos; no publica.** La reconciliación HTTP es una tarea independiente del consumo de eventos.

Variables en `.env`: `TRACKING_DB_NAME`, `TRACKING_DB_USER`, `TRACKING_DB_PASSWORD` (base exclusiva), `TRACKING_SYNC_SECRET` (compartida con Envíos), `RABBITMQ_URL`, `EXCHANGE_NAME` y `TRACKING_RABBITMQ_QUEUE`. Las credenciales no deben versionarse. Opcionales: `RABBITMQ_ROUTING_KEYS` y `RABBITMQ_RECONNECT_MS`.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/tracking/ubicaciones` | Recibe el GPS del cadete (valida), guarda la última posición con TTL configurable (`TRACKING_POS_TTL_S`, 30 s por defecto) y la publica |
| GET | `/tracking/cadetes` | Última posición de todos los cadetes con señal |
| GET | `/tracking/cadetes/:id/posicion` | Última posición de un cadete (404 si expiró) |
| GET | `/tracking/envios/:envioId/posicion` | Ídem, resolviendo el cadete asignado al envío |
| GET (SSE) | `/tracking/envios/:envioId/stream` | Vista del cliente: última posición conocida y luego en vivo, solo del cadete de ese envío |
| GET (SSE) | `/tracking/stream` | Vista del operador: todas las posiciones |
| GET | `/tracking/asignaciones` | Lee la proyección local PostgreSQL. El alta/baja oficial se hace en Envíos |
| GET | `/tracking/metrics` | Reportes/s, conexiones SSE y latencia interna (p50/p95/p99) |

Ejemplo de reporte directo (Tracking verifica el JWT y usa el username del token; `cadeteId` en el body se ignora):

```bash
curl -X POST localhost:3002/tracking/ubicaciones \
  -H "Authorization: Bearer $TOKEN_CADETE" \
  -H 'content-type: application/json' \
  -d '{"lat":-34.60,"lng":-58.40}'
```

## Decisiones

- **Redis solo para estado vivo:** una clave por cadete (`pos:{id}`) con TTL; si deja de reportar, expira y el mapa lo marca "sin señal". Reiniciar Redis no elimina asignaciones.
- **PostgreSQL exclusivo de Tracking:** conserva asignaciones recibidas incluso si Tracking cae; tablas en `tracking/db/init.sql`, volumen `tracking-pgdata`. No borrar el volumen al reiniciar.
- **HTTP POST** del cadete (tolera redes malas) y **SSE** hacia el cliente (solo escucha, reconexión automática).
- **Redis Pub/Sub** como fan-out: cada instancia recibe todas las posiciones y las reparte a sus clientes SSE, habilitando escala horizontal.
- **El mapa externo no se consulta en cada reporte:** las posiciones vienen del GPS y el navegador interpola el movimiento.

## Demo vs. producción

- Las asignaciones se gestionan en el módulo Operador del MS de Envíos (`PATCH /envios/{id}/asignar` o `/operador/asignaciones`). Tracking consume los eventos resultantes (`envio.asignado` / `envio.estado_actualizado`) y reconcilia su proyección periódicamente.
- Las vistas de seguimiento de la demo no autentican al cliente ni verifican que sea dueño del envío; el reporte GPS exige un token de cadete validado tanto por el Gateway como por Tracking.
- El simulador está configurado para arrancar con Compose, pero sus reportes sin JWT serán rechazados. Para hacerlo funcionar necesita tokens de cadete válidos y el archivo `simulator/sim.js`.
- Sin buffer offline en la app del cadete, sin límites de tasa y sin réplica de Redis.
- El simulador debe adaptar su publicación de GPS al flujo autenticado para generar posiciones visibles.
