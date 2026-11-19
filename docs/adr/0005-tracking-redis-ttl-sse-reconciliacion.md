# ADR-0005: Tracking en tiempo real con Redis TTL, SSE y reconciliación en PostgreSQL

- **Estado:** Aceptada
- **NFRs vinculados:** NFR-1 (Seguimiento en tiempo real), NFR-4 (Escalabilidad horizontal), NFR-5 (Resiliencia)

## Contexto
Durante el traslado (`EN_CAMINO`), los cadetes envían coordenadas GPS periódicas mientras clientes y operadores visualizan la posición en tiempo real. Persistir cada coordenada en una tabla relacional generaría alta contención de escritura, mientras que usar *polling* HTTP constante desde los frontends desperdiciaría ancho de banda. Al mismo tiempo, almacenar las asignaciones únicamente en memoria haría que `tracking` pierda noción de qué envíos sigue tras un reinicio.

## Decisión
Implementar el microservicio **`tracking/`** (NestJS) con una arquitectura híbrida de almacenamiento y difusión:

1. **Redis con TTL (`tracking-redis`) para última ubicación:** cada reporte GPS válido se guarda en Redis con expiración (`TRACKING_POS_TTL_S`). Si el cadete deja de emitir señal, la posición expira automáticamente y el frontend refleja pérdida de señal sin lógica manual de limpieza.
2. **Server-Sent Events (SSE) para difusión en vivo:** los clientes se suscriben al stream `/tracking/.../stream` (vía Gateway con cookie `mapa_token`), recibiendo actualizaciones push con reconexión controlada cada 30 s para revalidar permisos RBAC periódicamente.
3. **PostgreSQL propio (`tracking-db`) + Reconciliación:** `tracking` persiste las asignaciones recibidas desde RabbitMQ (`tracking.envios`) e historial de `eventId` en `tracking-db` (`eventos_procesados`) y cuenta con `ReconciliationService`, que consulta el endpoint interno de `envios` (`/internal/tracking/asignaciones` protegido con `TRACKING_SYNC_SECRET`) al arrancar y cada 60 segundos para recuperar asignaciones perdidas durante caídas.

## Alternativas evaluadas
1. **Polling HTTP cada pocos segundos desde `cliente-web` y `operador-front`:** descartada por mayor latencia percibida y sobrecarga innecesaria al Gateway.
2. **Solo Redis sin `tracking-db` ni reconciliación:** descartada porque un reinicio de Redis o una caída de `tracking` mientras ocurren asignaciones dejaría incoherente la autorización y visibilidad de envíos activos.

## Consecuencias
- **Positivas:**
  - Lecturas/escrituras de GPS en sub-milisegundos con expiración automática de señal obsoleta.
  - Recuperación automática del estado de asignaciones ante reinicios de contenedor.
- **Negativas / Riesgos:**
  - Mayor complejidad operativa al mantener dos almacenes (`tracking-redis` + `tracking-db`) y un secreto compartido (`TRACKING_SYNC_SECRET`) para reconciliación inicial.
