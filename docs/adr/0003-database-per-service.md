# ADR-0003: Aislamiento de datos mediante patrón Database-per-Service

- **Estado:** Aceptada
- **NFRs vinculados:** NFR-2 (Extensibilidad), NFR-4 (Escalabilidad horizontal), NFR-5 (Resiliencia)

## Contexto
Cada capacidad del negocio tiene patrones de acceso y modelos de consistencia distintos: `envios` necesita integridad transaccional ACID y auditoría histórica; `keycloak` gestiona identidad y sesiones; `tracking` requiere escrituras GPS de alta frecuencia y baja latencia junto con estado de asignaciones activas. Compartir una única base de datos generaría acoplamiento por esquema, contención de bloqueos y un punto único de fallo.

## Decisión
Aplicar el patrón **Database-per-Service** en la orquestación (`docker-compose.yml`):

- **`envios-db` (PostgreSQL 16):** exclusiva de `envios`. Almacena pedidos con PK **UUID v7** (`uuid_v7()`), coordenadas geocodificadas y la tabla de auditoría `historial_estados_envio`.
- **`keycloak-db` (PostgreSQL 16):** exclusiva de `keycloak` para persistir realms, usuarios y roles.
- **`tracking-redis` (Redis 7):** exclusiva de `tracking` para posiciones GPS efímeras con expiración automática (`TTL`).
- **`tracking-db` (PostgreSQL 16):** exclusiva de `tracking` para persistir asignaciones activas (`tracking/db/init.sql`) y permitir recuperación tras reinicios.
- **`mapas` y `notificaciones`:** mantienen estado en memoria acotado para caché/avisos y se sincronizan vía eventos sin acceder a bases de datos de terceros.

Ningún servicio consulta tablas de otro servicio; la comunicación entre límites se realiza únicamente por eventos en RabbitMQ o APIs explícitas (como el endpoint interno de reconciliación `/internal/tracking` en `envios`).

## Alternativas evaluadas
1. **Base de datos PostgreSQL compartida entre todos los microservicios:** descartada porque rompe el encapsulamiento del dominio, dificulta el escalado independiente y viola los lineamientos metodológicos de microservicios.

## Consecuencias
- **Positivas:**
  - Cada servicio elige el motor adecuado a su carga (PostgreSQL transaccional vs. Redis en memoria).
  - Cambios internos de esquema en `envios` o `tracking` no rompen a los demás servicios.
- **Negativas / Riesgos:**
  - No existen `JOIN` entre dominios; las consultas combinadas requieren replicación eventual por eventos o composición en el cliente/gateway.
  - Mayor cantidad de contenedores e inicialización de esquemas que gestionar en desarrollo.
