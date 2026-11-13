# Contrato de eventos (como está hoy en el repo)

Este documento describe lo que **ya publica Envíos** y lo que **agregan Mapas y Notificaciones**.
No inventa nada nuevo para los demás: los servicios de Mapas y Notificaciones se adaptaron al formato existente.

## Broker

- RabbitMQ del compose. Credenciales en `RABBITMQ_URL` (`amqp://guest:guest@rabbitmq:5672`).
- Exchange **`EXCHANGE_NAME`** (`motomensajeria.events`), tipo `topic`, durable.
- La *routing key* es el `eventType`. Mensajes JSON persistentes.

## Formato del mensaje

```json
{ "eventId": "uuid", "timestamp": "2026-11-08T14:03:10Z", "eventType": "envio.asignado", "data": { } }
```

El broker entrega *al menos una vez*: los consumidores ignoran los `eventId` que ya vieron.

## Eventos

| Evento | Lo publica | Lo consumen |
|---|---|---|
| `envio.creado` | Envíos | Mapas, Notificaciones |
| `envio.asignado` | Envíos | Tracking, Mapas, Notificaciones |
| `envio.estado_actualizado` | Envíos | Tracking, Mapas, Notificaciones |
| `envio.geocodificado` | **Mapas** | (Envíos, opcional) |
| `envio.eta_estimado` | **Mapas** | Notificaciones (Envíos, opcional) |
| `envio.geocodificacion_fallida` | **Mapas** | Notificaciones (Envíos, opcional) |

Estados de Envíos: `PENDIENTE`, `ASIGNADO`, `EN_CAMINO`, `ENTREGADO`, `NO_ENTREGADO`, `CANCELADO`.

### Los que ya publica Envíos

**`envio.creado`**: `data` es la fila completa del envío: `id` (UUID), `origen` y `destino` (texto),
`lat_origen`, `lon_origen`, `lat_destino`, `lon_destino` (pueden ser `null`), `estado`, `cliente`, etc.

**`envio.asignado`**: `{ envioId, cliente, mensajero, operador, estadoAnterior, estadoNuevo, fechaAsignacion }`

**`envio.estado_actualizado`**: `{ envioId, cliente, mensajero, estadoAnterior, estadoNuevo, timestamp }`
(también cuando el operador libera una asignación: `ASIGNADO` → `PENDIENTE`).

### Los que publica Mapas

**`envio.geocodificado`**
```json
{ "envioId": "…", "cliente": "cliente.demo",
  "origen":  { "direccion": "Av. Corrientes 1000, CABA", "lat": -34.6039, "lon": -58.379 },
  "destino": { "direccion": "Av. Cabildo 2000, CABA",    "lat": -34.5617, "lon": -58.4546 } }
```
Solo se publica si Mapas tuvo que ubicar alguna dirección (si el envío ya traía coordenadas, no hace falta).

**`envio.eta_estimado`**
```json
{ "envioId": "…", "cliente": "cliente.demo", "etaMinutos": 37, "origenCalculo": "mapas" }
```
Se publica al asignar (ruta + 10 min de retiro) y al pasar a `EN_CAMINO`. `origenCalculo` es `mapas` o `respaldo`
(estimación propia cuando el servicio de mapas no responde).

**`envio.geocodificacion_fallida`**
```json
{ "envioId": "…", "cliente": "cliente.demo", "motivo": "direccion_no_encontrada", "direccion": "Calle Inexistente 123" }
```
`motivo`: `direccion_no_encontrada` o `servicio_de_mapas_no_disponible` (en ese caso `direccion` es `null`).

## Qué hace cada servicio con cada evento

| Evento | Mapas | Notificaciones |
|---|---|---|
| `envio.creado` | Ubica origen y destino (si no traen coordenadas) y los recuerda | "Recibimos tu pedido" |
| `envio.asignado` | Estima el ETA | "Asignado a un cadete" |
| `envio.estado_actualizado` | Solo a `EN_CAMINO`: recalcula el ETA | `EN_CAMINO`, `ENTREGADO`, `NO_ENTREGADO`, `CANCELADO`, o "volvió a pendiente" si se liberó |
| `envio.eta_estimado` | — | "Llegaría en unos N minutos" |
| `envio.geocodificacion_fallida` | — | "No pudimos ubicar una dirección" |

## Colas

| Cola | Servicio |
|---|---|
| `mapas.envios` | Mapas |
| `q.notificaciones` | Notificaciones |
| `tracking.envios` | Tracking |

## Garantías y advertencias

- **Sin orden entre colas distintas.** El aviso de ETA puede llegar antes que el de "asignado".
- **Una cola existe desde que su servicio arranca por primera vez.** Los eventos publicados antes se pierden para ese servicio:
  levanten el compose completo antes de probar el apagado de un servicio.
- **Mapas recuerda los envíos en memoria.** Si se reinicia, no puede estimar el ETA de un envío ya creado, salvo que el
  evento traiga `origen` y `destino` (ver mejoras opcionales).
- Si un consumidor falla procesando un mensaje, se reintenta una vez y después se descarta con un log.

## Mejoras opcionales para Envíos (ninguna bloquea nada)

1. **Consumir `envio.geocodificado`** y guardar `lat_*`/`lon_*`: hoy quedan en `null` salvo que el cliente las mande,
   y el panel del operador no puede dibujar el envío.
2. **Consumir `envio.eta_estimado`** y guardar el ETA para mostrarlo en el panel.
3. **Incluir `origen` y `destino` (texto) en `envio.asignado` y `envio.estado_actualizado`:** Mapas recupera el ETA
   aunque se haya reiniciado.
4. **Incluir `motivo` en `envio.estado_actualizado`** (sobre todo en `NO_ENTREGADO`): el aviso al cliente lo menciona.
