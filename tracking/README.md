# Microservicio de Tracking

Tracking en tiempo real del escenario 3B: **NestJS + Redis + SSE + RabbitMQ**. Guarda la última posición de cada cadete con TTL, la distribuye a las vistas en vivo y consume eventos de asignación desde el broker.

## Acceso

Con el stack completo levantado (`docker compose up -d --build`):

- **Operador:** http://localhost:3002 — todos los cadetes en el mapa, métricas y seguimiento por envío.
- **Cliente:** http://localhost:3002/cliente.html?envio=01a1a901-5800-7000-8000-000000000001 — solo el canal SSE de ese envío. Requiere que el envío esté asignado desde el módulo Operador del MS de Envíos.
- **Métricas:** http://localhost:3002/tracking/metrics

El contenedor escucha internamente en `3000`; el host publica en `3002` (`TRACKING_PORT`) para no chocar con el API Gateway.

## Flujo

```
App cadete ──POST /tracking/ubicaciones──▶ Tracking MS ──SET (TTL) + PUBLISH──▶ Redis
                                                ▲                                  │
                                                └────── Pub/Sub (todas las instancias)
Cliente ◀──SSE /tracking/envios/:id/stream── Tracking MS     Operador ◀──SSE /tracking/stream
```

## Eventos de RabbitMQ

Tracking se conecta al broker y consume del exchange `motomensajeria.events` con una cola durable `tracking.envios`:

| Evento | Acción |
|---|---|
| `envio.asignado` | Guarda `asig:{envioId}` → `mensajero` en Redis |
| `envio.estado_actualizado` (`PENDIENTE`, `ENTREGADO`, `NO_ENTREGADO`, `CANCELADO`) | Elimina la asignación del envío |
| `envio.entregado` | Elimina la asignación del envío |

La fuente de verdad de las asignaciones es el MS de Envíos (módulo Operador). Tracking solo mantiene una proyección de solo lectura en Redis para resolver `envioId → cadeteId` en los canales SSE.

La conexión se reintenta automáticamente y el arranque de Tracking no depende de que RabbitMQ esté disponible en ese instante. **Por ahora solo consume eventos; no publica.**

Variables **obligatorias** (si falta una, Tracking no arranca): `RABBITMQ_URL`, `RABBITMQ_EXCHANGE` y `RABBITMQ_QUEUE`. El `docker-compose.yml` las toma de `RABBITMQ_URL`, `EXCHANGE_NAME` y `TRACKING_RABBITMQ_QUEUE` en el `.env`, y falla al levantar si alguna no está definida. Opcionales: `RABBITMQ_ROUTING_KEYS` y `RABBITMQ_RECONNECT_MS`.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/tracking/ubicaciones` | Recibe el GPS del cadete (valida), guarda la última posición con TTL de 30 s y la publica |
| GET | `/tracking/cadetes` | Última posición de todos los cadetes con señal |
| GET | `/tracking/cadetes/:id/posicion` | Última posición de un cadete (404 si expiró) |
| GET | `/tracking/envios/:envioId/posicion` | Ídem, resolviendo el cadete asignado al envío |
| GET (SSE) | `/tracking/envios/:envioId/stream` | Vista del cliente: última posición conocida y luego en vivo, solo del cadete de ese envío |
| GET (SSE) | `/tracking/stream` | Vista del operador: todas las posiciones |
| GET | `/tracking/asignaciones` | Proyección de solo lectura de las asignaciones recibidas por RabbitMQ. El alta/baja se hace en `/operador/asignaciones` del MS de Envíos |
| GET | `/tracking/metrics` | Reportes/s, conexiones SSE y latencia interna (p50/p95/p99) |

Ejemplo de reporte (username de Keycloak, como en producción):

```bash
curl -X POST localhost:3002/tracking/ubicaciones \
  -H 'content-type: application/json' \
  -d '{"cadeteId":"cadete.demo","lat":-34.60,"lng":-58.40}'
```

## Decisiones

- **Redis solo para estado vivo:** una clave por cadete (`pos:{id}`) con TTL; si deja de reportar, expira y el mapa lo marca "sin señal". Sin historial en Tracking.
- **HTTP POST** del cadete (tolera redes malas) y **SSE** hacia el cliente (solo escucha, reconexión automática).
- **Redis Pub/Sub** como fan-out: cada instancia recibe todas las posiciones y las reparte a sus clientes SSE, habilitando escala horizontal.
- **El mapa externo no se consulta en cada reporte:** las posiciones vienen del GPS y el navegador interpola el movimiento.

## Demo vs. producción

- Las asignaciones se gestionan en el módulo Operador del MS de Envíos (`PATCH /envios/{id}/asignar` o `/operador/asignaciones`). Tracking solo consume los eventos resultantes (`envio.asignado` / `envio.estado_actualizado`).
- Sin autenticación ni verificación de que el cliente sea dueño del envío.
- Sin buffer offline en la app del cadete, sin límites de tasa y sin réplica de Redis.
- El simulador acelera la velocidad (`SPEED_MS=40`) para que el movimiento se note en el mapa.
