# ADR-0001: Arquitectura Event-Driven con RabbitMQ Topic Exchange y Dead Letter Exchange

- **Estado:** Aceptada
- **NFRs vinculados:** NFR-1 (Tiempo real), NFR-2 (Extensibilidad), NFR-5 (Resiliencia), NFR-7 (Idempotencia)

## Contexto
El dominio logístico requiere que una transición de estado en un envío (creación, asignación a cadete, retiro, entrega) dispare reacciones en múltiples capacidades independientes: actualización de seguimiento en vivo, geocodificación y cálculo de ETA, notificaciones al cliente y auditoría. Acoplar `envios` mediante llamadas HTTP síncronas hacia todos los consumidores degradaría la latencia transaccional, impediría incorporar nuevos suscriptores sin modificar el productor y propagaría caídas parciales.

## Decisión
Adoptar un bus de eventos centralizado en **RabbitMQ** (`broker/definitions.json`) bajo un **Topic Exchange** durable (`motomensajeria.events`) con mensajes JSON persistentes (`{ eventId, timestamp, eventType, data }`) y una estrategia de **Dead Letter Exchange** (`motomensajeria.dlx` → `q.dead-letter`).

- Los productores (`envios`, `mapas`) publican eventos usando el `eventType` como *routing key* (`envio.creado`, `envio.asignado`, `envio.estado_actualizado`, `envio.geocodificado`, `envio.eta_estimado`, `envio.geocodificacion_fallida`).
- `broker/definitions.json` pre-declara las colas con DLX (`q.auditoria`, `q.notificaciones`, `q.tracking` → `q.dead-letter`), mientras los microservicios activos declaran y consumen sus colas durables (`tracking.envios`, `mapas.envios`, `envios.geocodificacion` y `q.notificaciones` alineada con los mismos parámetros DLX) con *prefetch* acotado y confirmación manual (`ack`/`nack`).
- Los consumidores implementan **idempotencia por `eventId`** para tolerar entrega *at-least-once*.

## Alternativas evaluadas
1. **Orquestación HTTP síncrona desde `envios`:** descartada por alto acoplamiento temporal, pérdida de eventos si un consumidor está caído y dificultad para extender el sistema (viola NFR-2 y NFR-5).
2. **Apache Kafka:** descartado por sobrecarga operativa y de memoria innecesaria para la escala académica del trabajo frente a RabbitMQ, manteniendo además un esquema simple de *topic routing* + DLX preconfigurado.

## Consecuencias
- **Positivas:**
  - Agregar nuevos consumidores (como `mapas` o `notificaciones`) no requiere modificar el núcleo de `envios`.
  - Si un consumidor cae (`notificaciones`, `tracking` o `mapas`), los mensajes persisten en su cola y se procesan al recuperarse.
  - Mensajes malformados o irrecuperables no bloquean el flujo principal gracias al manejo de reintentos y DLX.
- **Negativas / Riesgos:**
  - Consistencia eventual entre servicios; exige diseñar consumidores idempotentes.
  - Las colas predeclaradas con atributos DLX en `broker/definitions.json` requieren que los consumidores coincidan en dichos parámetros para evitar errores `PRECONDITION_FAILED` al hacer `assertQueue`.
