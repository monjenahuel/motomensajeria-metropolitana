# Especificación Formal de Requerimientos No Funcionales (NFRs)
**Dominio 3: Mensajería en moto — Escenario 3B: Operador Logístico Metropolitano**  
**Materia:** Arquitectura de Software 1 — UNAHUR  

---

## 1. Caracterización del Dominio y Carga de Diseño

A partir del análisis del escenario 3B se establecen los siguientes parámetros cuantitativos de diseño que condicionan las decisiones arquitectónicas:

| Parámetro | Valor de diseño | Impacto arquitectónico |
| :--- | :--- | :--- |
| **Cadetes activos en simultáneo** | 600 cadetes | Generan flujo sostenido de ubicación y sesiones concurrentes de seguimiento. |
| **Volumen diario de envíos** | 15.000 envíos/día | ~75.000 eventos de negocio/día (~5 transiciones promedio por envío). |
| **Frecuencia de telemetría GPS** | 1 reporte cada 5 s por cadete | Carga base continua de **120 req/s** en horario pico. |
| **Picos estimados de telemetría (5x)** | Hasta **600 req/s** | Exige desacoplar la ingesta GPS de PostgreSQL usando Redis en memoria con TTL. |
| **Observadores en vivo** | 600 a 1.200 clientes | Justifica propagación push por SSE (`/tracking/.../stream` y `/notificaciones/stream`) en vez de polling HTTP. |
| **Cuota del proveedor externo de mapas** | ≤ 5 consultas/envío ($0$ por GPS) | Cobra por request; prohíbe geocodificar o rutear en cada reporte GPS. |
| **Organización y extensibilidad** | 4 equipos independientes | Impone bajo acoplamiento para incorporar Facturación, Premios y Analítica sin tocar el *core*. |

---

## 2. Priorización de Atributos de Calidad

En función de esta carga y las restricciones críticas del negocio, se priorizan los atributos de calidad (`NFR-1` a `NFR-7`) en consistencia con la Matriz de Pugh y los ADRs del sistema:

| ID | Atributo de calidad | Prioridad | Justificación en el escenario 3B |
| :--- | :--- | :--- | :--- |
| **NFR-1** | Tiempo Real | **Crítica (★ NFR Estrella)** | Ingesta rápida de GPS (`202 Accepted`) y propagación en vivo por SSE de ubicaciones, estados y avisos. |
| **NFR-2** | Extensibilidad y Desacoplamiento | **Crítica (★ NFR Estrella)** | Integrar nuevos módulos (Facturación, Premios, Analítica) vía RabbitMQ sin modificar ni redesplegar el *core*. |
| **NFR-3** | Eficiencia de Costos en Mapas | **Alta** | Limitar consultas externas solo a hitos del envío con caché en memoria y 0 llamadas ante pings GPS. |
| **NFR-4** | Escalabilidad Horizontal | **Alta** | Absorber ráfagas de 120 a 600 req/s replicando servicios *stateless* apoyados en Redis y RabbitMQ. |
| **NFR-5** | Disponibilidad y Resiliencia | **Alta** | Degradar con reintentos + fallback Haversine ante fallas externas y colas durables + reconciliación en `tracking-db`. |
| **NFR-6** | Seguridad y Control de Acceso | **Media-Alta (Obligatoria)** | Identidad OIDC (Keycloak), RBAC en dos capas, control de *ownership* por recurso y cookie `HttpOnly` para SSE. |
| **NFR-7** | Confiabilidad e Idempotencia | **Media-Alta** | Consistencia ACID (`SELECT ... FOR UPDATE`), trazabilidad histórica e idempotencia por `eventId` ante reentregas. |

---

## 3. Escenarios de Calidad

Cada requerimiento no funcional se formaliza mediante la estructura canónica de seis partes del SEI:
1. **Fuente del estímulo (*Source*):** Entidad interna o externa que genera la condición.
2. **Estímulo (*Stimulus*):** La acción, solicitud o falla que arriba al sistema.
3. **Artefacto (*Artifact*):** Componente, subsistema o entorno que recibe el estímulo.
4. **Entorno (*Environment*):** Condiciones operativas del sistema al momento del estímulo.
5. **Respuesta (*Response*):** Comportamiento esperado y acciones que ejecuta la arquitectura.
6. **Medida de respuesta (*Response Measure*):** Métrica cuantitativa, objetiva y verificable.

---

### NFR-1: Tiempo Real

#### Escenario 1.1: Propagación en Vivo de Estados y Avisos SSE
* **Fuente del estímulo:** Operador o cadete autenticado.
* **Estímulo:** Cambio de estado vía `PATCH /envios/{id}/asignar`, `POST /operador/asignaciones`, `PATCH /cadete/envios/{id}/estado` o `PATCH /envios/{id}/estado`.
* **Artefacto:** Core `envios`, Message Broker (`motomensajeria.events`), `notificaciones` y API Gateway SSE.
* **Entorno:** Operación normal con hasta 1.200 observadores conectados.
* **Respuesta:** `envios` persiste la transición en PostgreSQL, publica el evento al broker y `notificaciones` empuja el aviso por `GET /notificaciones/stream` (SSE) hacia los usuarios autorizados sin requerir polling HTTP.
* **Medida de respuesta:**
  - Latencia extremo a extremo $\le 2{,}0\text{ s}$ ($p95$) y $\le 4{,}0\text{ s}$ ($p99$).

#### Escenario 1.2: Ingesta de Telemetría GPS y Difusión en Vivo
* **Fuente del estímulo:** Hasta 600 cadetes reportando cada 5 s.
* **Estímulo:** `POST /tracking/ubicaciones` (120 req/s sostenidos, picos de 600 req/s).
* **Artefacto:** API Gateway, `tracking` (`CadeteAuthGuard` + SSE) y `tracking-redis`.
* **Entorno:** Operación continua con seguimiento activo en mapas.
* **Respuesta:** `tracking` graba la última posición en Redis con TTL (`TRACKING_POS_TTL_S`), publica por Redis Pub/Sub y difunde vía SSE (`/tracking/stream` y `/tracking/envios/{envioId}/stream` con latido cada 15 s) sin escribir en bases relacionales.
* **Medida de respuesta:**
  - Confirmación `HTTP 202 Accepted` con $p95 \le 200\text{ ms}$ y $p99 \le 400\text{ ms}$.
  - Tasa de error HTTP 5xx $< 0{,}01\%$.

---

### NFR-2: Extensibilidad y Desacoplamiento

#### Escenario 2.1: Alta de Nuevos Consumidores sin Tocar el Core
* **Fuente del estímulo:** Equipos independientes (Facturación automática, Premios para cadetes, Analítica operativa).
* **Estímulo:** Despliegue de un nuevo consumidor de eventos sobre el sistema en producción.
* **Artefacto:** RabbitMQ Topic Exchange (`motomensajeria.events`) y servicio `envios`.
* **Entorno:** Sistema productivo activo sin ventanas de parada (*zero-downtime*).
* **Respuesta:** El nuevo módulo declara su propia cola durable vinculada a `envio.*` (`envio.creado`, `envio.asignado`, `envio.estado_actualizado`, `envio.geocodificado`, `envio.eta_estimado`) sin modificar ni redesplegar `envios` ni `tracking`.
* **Medida de respuesta:**
  - **0** líneas modificadas en `envios` y `tracking`.
  - **0 s** de *downtime* en servicios existentes.

#### Escenario 2.2: Evolución Compatible de Esquemas de Eventos
* **Fuente del estímulo:** Productor enviando metadatos opcionales en el sobre JSON `{ eventId, timestamp, eventType, data }`.
* **Estímulo:** Publicación de evento extendido retrocompatible.
* **Artefacto:** Consumidores existentes (`mapas`, `notificaciones`, `tracking`).
* **Entorno:** Despliegues desacoplados entre equipos.
* **Respuesta:** Los consumidores aplican el patrón *tolerant reader* e ignoran atributos desconocidos.
* **Medida de respuesta:** **0** fallos de deserialización o roturas de compatibilidad regresiva.

---

### NFR-3: Eficiencia de Costos en Mapas Externos

#### Escenario 3.1: Aislamiento Estricto de Telemetría respecto a Mapas Pagos
* **Fuente del estímulo:** Flujo GPS de 600 cadetes (~5,2 millones de pings/día).
* **Estímulo:** Recepción continua de coordenadas en `POST /tracking/ubicaciones`.
* **Artefacto:** `tracking` y adaptador `mapas/`.
* **Entorno:** Operación normal continua.
* **Respuesta:** Las posiciones circulan internamente por `tracking-redis` y SSE sin invocar al proveedor externo (`mock-mapas`, Nominatim ni OSRM).
* **Medida de respuesta:**
  - Exactamente **0 consultas externas** derivadas de reportes de telemetría GPS.

#### Escenario 3.2: Cuota Máxima por Envío y Caché en Memoria
* **Fuente del estímulo:** Ciclo de vida de 15.000 envíos diarios.
* **Estímulo:** Eventos `envio.creado`, `envio.asignado` y transición a `EN_CAMINO`.
* **Artefacto:** Adaptador `mapas/` (`cacheDirecciones`, `cacheRutas`) y `envios-db`.
* **Entorno:** Operación diaria con direcciones nuevas o recurrentes.
* **Respuesta:** `mapas` geocodifica origen y destino en `envio.creado` solo cuando faltan coordenadas y consulta la ruta en `envio.asignado` reutilizando `cacheRutas` en `EN_CAMINO`, mientras `envios-db` aplica `CHECK (consultas_mapas_realizadas <= 5)`.
* **Medida de respuesta:**
  - $\le 3\text{ a }4$ consultas promedio por envío (0 en geocodificación si ya hay coordenadas o acierto de caché).
  - Tope estricto $\le 5$ llamadas externas por envío.

---

### NFR-4: Escalabilidad Horizontal y Rendimiento

#### Escenario 4.1: Absorción de Picos 5x y Réplicas Stateless
* **Fuente del estímulo:** Crecimiento de flota o picos horarios.
* **Estímulo:** Ráfagas de 600 pings GPS/s y aumento de altas de envío.
* **Artefacto:** `gateway`, `tracking`, `tracking-redis` y `rabbitmq`.
* **Entorno:** Horas pico metropolitanas.
* **Respuesta:** Los contenedores *stateless* escalan horizontalmente sin afinidad de sesión ni migraciones de esquema; Redis Pub/Sub distribuye posiciones entre réplicas y RabbitMQ absorbe ráfagas sin rechazar mensajes.
* **Medida de respuesta:**
  - Latencia $p95$ de confirmación de telemetría $\le 300\text{ ms}$.
  - Pérdida de eventos transaccionales: **0%**.

---

### NFR-5: Disponibilidad y Resiliencia

#### Escenario 5.1: Degradación Elegante ante Caída del Proveedor de Mapas
* **Fuente del estímulo:** Falla o corte del proveedor externo (`mock-mapas` / Nominatim / OSRM).
* **Estímulo:** Timeout (`MAPAS_TIMEOUT_MS=2000`) o respuesta HTTP 503 al geocodificar o calcular ruta.
* **Artefacto:** Adaptador `mapas/` (`cliente-mapas.js`, `handlers.js`, `geo.js`).
* **Entorno:** Creación y asignación de envíos en curso.
* **Respuesta:** `mapas` ejecuta hasta 3 reintentos con backoff exponencial (500 ms, 1 s, 2 s); ante falla persistente al estimar ETA conmuta a distancia Haversine local (`VELOCIDAD_RESPALDO_KMH=25`) publicando `envio.eta_estimado` con `origenCalculo: "respaldo"`, o publica asíncronamente `envio.geocodificacion_fallida` sin bloquear `POST /envios` (`201 Created`).
* **Medida de respuesta:**
  - **0%** de bloqueo o degradación transaccional en el alta y asignación de `envios`.

#### Escenario 5.2: Aislamiento de Fallas en Consumidores y Reconciliación de Tracking
* **Fuente del estímulo:** Caída temporal de `notificaciones`, `mapas` o `tracking`.
* **Estímulo:** Consumidor detenido mientras `envios` emite eventos.
* **Artefacto:** Colas durables + DLX de RabbitMQ (`motomensajeria.dlx` → `q.dead-letter`), `tracking-db` y `ReconciliationService`.
* **Entorno:** Operación transaccional activa.
* **Respuesta:** RabbitMQ retiene los eventos en disco y drena las colas al recuperarse el servicio; `tracking` conserva su proyección en `tracking-db` y reconcilia al iniciar y cada 60 s vía `GET /internal/tracking/asignaciones` (`TRACKING_SYNC_SECRET`).
* **Medida de respuesta:**
  - **0%** de pérdida de eventos encolados ni de asignaciones vigentes.

---

### NFR-6: Seguridad y Control de Acceso (OIDC / RBAC)

#### Escenario 6.1: Identidad Delegada, RBAC en Dos Capas y Sesiones SSE Seguras
* **Fuente del estímulo:** Cliente, cadete, operador o tercero externo.
* **Estímulo:** Solicitud HTTP/SSE con credenciales ausentes, rol insuficiente o acceso a envío ajeno.
* **Artefacto:** Keycloak OIDC, `api-gateway`, `envios`, `tracking` y `notificaciones`.
* **Entorno:** Operación general expuesta.
* **Respuesta:** Validación JWT vía JWKS y defensa en profundidad por rol (`administrador`, `operador`, `cadete`, `cliente`) y propiedad del recurso: responde HTTP `401` sin token válido, `403` sin rol y `404` ante envíos ajenos en formato Problem Details (`application/problem+json`). En telemetría, `CadeteAuthGuard` impone `cadeteId` desde `preferred_username`, y los mapas SSE utilizan cookie `HttpOnly` `mapa_token` (`POST /mapas/sesion`, `Max-Age=300`) con reconexión cada 30 s.
* **Medida de respuesta:**
  - **100%** de accesos no autorizados bloqueados y **0** tokens expuestos en URLs.

---

### NFR-7: Confiabilidad, Consistencia e Idempotencia

#### Escenario 7.1: Bloqueo Pesimista e Idempotencia por `eventId`
* **Fuente del estímulo:** Operaciones concurrentes de operadores/cadetes o reentregas del broker RabbitMQ.
* **Estímulo:** Asignación doble, mutación de un envío ya finalizado o *redelivery* de eventos.
* **Artefacto:** `envios-db` (`historial_estados_envio`), `tracking-db` (`eventos_procesados`), `mapas` y `notificaciones`.
* **Entorno:** Concurrencia operativa y entrega *at-least-once* en colas.
* **Respuesta:** `envios` ejecuta transacciones con `SELECT ... FOR UPDATE`, rechaza transiciones inválidas con HTTP `409 Conflict` y registra auditoría en `historial_estados_envio`; los consumidores filtran `eventId` repetidos (tabla *inbox* `eventos_procesados` con `COMMIT` previo al `ACK` en `tracking-db`, y conjuntos en memoria acotados en `mapas` y `notificaciones`).
* **Medida de respuesta:**
  - **0** registros, avisos o consultas duplicadas ante concurrencia o *redelivery*.

---

## 4. Matriz de Trazabilidad: Decisiones Tácticas vs. NFRs

| Decisión Arquitectónica / Táctica | NFR Principal | NFR Secundario | Compromiso / Trade-off Asumido |
| :--- | :--- | :--- | :--- |
| **Broker RabbitMQ (`motomensajeria.events` + DLX)** | **NFR-2** (Extensibilidad) | **NFR-5** (Resiliencia) | Complejidad operativa y consistencia eventual entre módulos. |
| **Separación de Telemetría (`tracking-redis` TTL + SSE) vs. `envios-db`** | **NFR-1** (Tiempo Real) | **NFR-4** (Escalabilidad) | Se prescinde del historial GPS persistido en disco a cambio de baja latencia. |
| **Proyección `tracking-db` + `eventos_procesados` + Reconciliación 60 s** | **NFR-5** (Resiliencia) | **NFR-7** (Idempotencia) | Copia eventualmente consistente y dependencia de credencial interna `TRACKING_SYNC_SECRET`. |
| **Adaptador `mapas/` por hitos + caché en memoria** | **NFR-3** (Costo) | **NFR-1** (Tiempo Real) | Caché local por instancia; las rutas no se recalculan en cada ping GPS. |
| **Reintentos con backoff + fallback Haversine en `mapas/`** | **NFR-5** (Disponibilidad) | **NFR-3** (Costo) | En modo `respaldo` el ETA es aproximación lineal sin tráfico ni sentido de calles. |
| **API Gateway + Keycloak OIDC/JWKS + Cookie `HttpOnly` `mapa_token`** | **NFR-6** (Seguridad) | **NFR-4** (Escalabilidad) | Validación criptográfica *stateless* sin consultar a Keycloak en cada request. |
| **Transacciones `SELECT ... FOR UPDATE` + Auditoría `historial_estados_envio`** | **NFR-7** (Consistencia) | **NFR-6** (Seguridad) | Contención puntual de fila al mutar un mismo envío concurrentemente. |
