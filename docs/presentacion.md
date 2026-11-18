# Guion de Presentación (PPT) y Demo en Vivo — Escenario 3B (UNAHUR)

Guía slide por slide para armar las diapositivas y ejecutar la demostración en vivo de **Motomensajería Metropolitana**.

---

## Parte 1: Estructura sugerida (12 slides)

### Slide 1 — Portada
- **Contenido:** Título (*Operador Logístico Metropolitano — Arquitectura Event-Driven*), materia (Arquitectura de Software 1 — UNAHUR), integrantes (Ezequiel, Matías, Nahuel, Ángel) y stack (PERN + RabbitMQ + Keycloak + Redis + Docker Compose).
- **Quién habla:** Todos / Introducción breve (Ezequiel o Nahuel).

### Slide 2 — Problemática y Escenario 3B
- **Contenido:** Necesidad de un operador logístico metropolitano con múltiples actores (Cliente, Operador, Cadete, Administrador), seguimiento en tiempo real, estimación de tiempos (ETA) y alta tolerancia a fallos.
- **Quién habla:** Matías.

### Slide 3 — Atributos de Calidad (NFRs)
- **Contenido:** Resumen visual de los 7 NFRs de [NFR.md](NFR.md):
  - **NFR-1:** Tracking en tiempo real (SSE + Redis TTL).
  - **NFR-2:** Extensibilidad vía eventos.
  - **NFR-3:** Control de costos de API de mapas (máx. consultas por hito).
  - **NFR-4:** Escalabilidad horizontal (stateless + Redis).
  - **NFR-5:** Resiliencia (RabbitMQ durable + DLX + fallback Haversine + reconciliación).
  - **NFR-6:** Seguridad (Keycloak OIDC + RBAC + Cookie `HttpOnly`).
  - **NFR-7:** Idempotencia y auditoría de transiciones.
- **Quién habla:** Ezequiel.

### Slide 4 — Vista de Contexto y Contenedores (C4 Niveles 1 y 2)
- **Contenido:** Exportar o capturar los diagramas de [c4.md](c4.md) mostrando las 3 SPAs, API Gateway (`:3000`), Keycloak (`:8081`), RabbitMQ (`:5672`), los 4 microservicios (`envios`, `tracking`, `mapas`, `notificaciones`) y sus bases aisladas (*Database-per-Service*).
- **Quién habla:** Ezequiel.

### Slide 5 — Seguridad, Identidad y API Gateway (ADR-0002)
- **Contenido:** Flujo OIDC/JWT con Keycloak, `POST /auth/token`, validación JWKS + RBAC en Gateway y microservicios, y cookie `HttpOnly` (`mapa_token`) para proteger SSE e iframes sin exponer tokens en URL.
- **Quién habla:** Ezequiel + Nahuel.

### Slide 6 — Arquitectura Event-Driven y Contrato de Eventos (ADR-0001)
- **Contenido:** Exchange `motomensajeria.events` (`topic`), colas por dominio (`tracking.envios`, `mapas.envios`, `q.notificaciones`, `envios.geocodificacion`, `q.auditoria`), DLX (`motomensajeria.dlx` → `q.dead-letter`) e idempotencia por `eventId` ([contrato-eventos.md](contrato-eventos.md)).
- **Quién habla:** Ezequiel.

### Slide 7 — Core Transaccional de Envíos y Operador (ADR-0003)
- **Contenido:** `envios/` + `envios-db` (UUID v7, máquina de estados, tabla `historial_estados_envio`) y `operador-front` (`:5173`) para asignación y monitoreo.
- **Quién habla:** Matías.

### Slide 8 — Tracking en Tiempo Real y App del Cadete (ADR-0005)
- **Contenido:** `tracking/` (NestJS) + `tracking-redis` (TTL) + `tracking-db` (PostgreSQL + `ReconciliationService`) + SSE en vivo + `cadete-front` (`:5174`) con reporte GPS autenticado (`CadeteAuthGuard`).
- **Quién habla:** Nahuel.

### Slide 9 — Adaptador de Mapas y Notificaciones (ADR-0004)
- **Contenido:** `mapas/` + `mock-mapas` (`:4000`), caché de geocodificación/rutas, reintentos y fallback Haversine; `notificaciones/` consumiendo `q.notificaciones` con avisos idempotentes al cliente.
- **Quién habla:** Ángel.

### Slide 10 — Web del Cliente (`cliente-web`) y Experiencia Integral
- **Contenido:** Captura de `cliente-web` (`:5175`): creación de envíos, listado, historial de auditoría y mapa embebido en vivo cuando el envío pasa a `EN_CAMINO`.
- **Quién habla:** Ezequiel.

### Slide 11 — Validación y Evidencias (Pruebas / Métricas)
- **Contenido:** Captura de `docker compose ps`, ejecución de `scripts/test-caso-uso-ezequiel.js`, colas en RabbitMQ (`:15672`) y contador `/stats` de `mock-mapas` demostrando NFR-3 y NFR-5.
- **Quién habla:** Todos (rotando en la demo).

### Slide 12 — Conclusiones y Trabajo Futuro
- **Contenido:** Lecciones aprendidas (contratos de eventos, aislamiento de bases, sincronización DLX en colas compartidas) y próximos pasos (Caché distribuida en `mapas`, persistencia de `notificaciones`, CI/CD).
- **Quién habla:** Cierre grupal.

---

## Parte 2: Guion de Demo en Vivo (Paso a paso, ~5 minutos)

### Pre-requisitos antes de exponer
1. Levantar todo el entorno:
   ```powershell
   docker compose up -d --build
   docker compose ps
   ```
2. Tener abiertas 5 pestañas en el navegador:
   - **Cliente:** `http://localhost:5175` (`cliente.demo` / ver credenciales en `README.md`)
   - **Operador:** `http://localhost:5173` (`operador.demo`)
   - **Cadete:** `http://localhost:5174` (`cadete.demo`)
   - **RabbitMQ Management:** `http://localhost:15672` (`guest` / `guest`)
   - **Swagger UI:** `http://localhost:8080`

### Paso 1 — Creación de envío y eventos iniciales (Ezequiel + Ángel)
1. En **Cliente (`:5175`)**, iniciar sesión con `cliente.demo` y crear un envío (ej. Origen `Av. Corrientes 1000, CABA`, Destino `Av. Cabildo 2000, CABA`).
2. Mostrar que `cliente-web` pega solo al Gateway (`:3000`) y que el envío queda en estado `PENDIENTE`.
3. Mostrar en logs de `microservicio-notificaciones` el aviso `Recibimos tu pedido #...` (consumido de `q.notificaciones`).

### Paso 2 — Asignación y cálculo de ETA (Matías + Ángel)
1. En **Operador (`:5173`)**, iniciar sesión con `operador.demo` y asignar el envío a `cadete.demo`.
2. Mostrar en `http://localhost:4000/stats` (`mock-mapas`) que solo se consultaron rutas/geocodificación en los hitos del envío (NFR-3) y en logs de `notificaciones` el aviso de ETA estimado.

### Paso 3 — Seguimiento en vivo y reporte GPS (Nahuel + Ezequiel)
1. En **Cadete (`:5174`)**, iniciar sesión con `cadete.demo`, pasar el envío a `EN_CAMINO` y enviar reportes GPS desde el panel de ubicación.
2. Volver a **Cliente (`:5175`)** (y **Operador (`:5173`)**): mostrar el mapa embebido actualizándose en tiempo real vía SSE + cookie `HttpOnly` (`mapa_token`).
3. En **Cadete (`:5174`)**, marcar el envío como `ENTREGADO`.
4. En **Cliente (`:5175`)**, abrir el detalle del envío y mostrar el historial completo de auditoría (`PENDIENTE → ASIGNADO → EN_CAMINO → ENTREGADO`).

### Paso 4 — Prueba rápida de resiliencia / automatizada (opcional si hay tiempo)
- Ejecutar en terminal `node scripts/test-caso-uso-ezequiel.js` o mostrar en RabbitMQ (`:15672`) que `q.dead-letter` está en `0` y las colas activas drenaron correctamente.
