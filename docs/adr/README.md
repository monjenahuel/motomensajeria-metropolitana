# Architecture Decision Records (ADRs)

Índice de decisiones arquitectónicas del proyecto **Operador Logístico Metropolitano (Motomensajería — UNAHUR)**.

| ID | Decisión | Estado | NFRs vinculados |
|---|---|---|---|
| [ADR-0001](0001-arquitectura-event-driven-rabbitmq-dlx.md) | Arquitectura Event-Driven con RabbitMQ Topic Exchange y Dead Letter Exchange | Aceptada | NFR-1, NFR-2, NFR-5, NFR-7 |
| [ADR-0002](0002-api-gateway-keycloak-oidc-rbac.md) | API Gateway único y autenticación federada con Keycloak (OIDC/JWKS + RBAC) | Aceptada | NFR-6 |
| [ADR-0003](0003-database-per-service.md) | Aislamiento de datos mediante patrón Database-per-Service | Aceptada | NFR-2, NFR-4, NFR-5 |
| [ADR-0004](0004-adaptador-mapas-cache-reintentos-fallback.md) | Adaptador de Mapas con caché en memoria, reintentos y fallback geográfico | Aceptada | NFR-3, NFR-5 |
| [ADR-0005](0005-tracking-redis-ttl-sse-reconciliacion.md) | Tracking en tiempo real con Redis TTL, Server-Sent Events (SSE) y reconciliación en PostgreSQL | Aceptada | NFR-1, NFR-4, NFR-5 |
