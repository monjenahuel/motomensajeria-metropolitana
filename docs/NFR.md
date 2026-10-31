# Especificación Formal de Requerimientos No Funcionales (NFRs)
**Dominio 3: Mensajería en moto — Escenario 3B: Operador Logístico Metropolitano**  
**Materia:** Arquitectura de Software 1 — UNAHUR  

---

## 1. Caracterización del Dominio y Carga de Diseño

A partir de las especificaciones del escenario 3B se establecen los siguientes parámetros cuantitativos base para el dimensionamiento del sistema:

| Parámetro | Valor de diseño | Justificación / Origen |
| :--- | :--- | :--- |
| **Cadetes activos en simultáneo** | 600 cadetes | Enunciado oficial del escenario. |
| **Volumen diario de envíos** | 15.000 envíos/día | Enunciado oficial del escenario. |
| **Frecuencia de telemetría GPS** | 1 reporte cada 5 s por cadete | Enunciado oficial del escenario. |
| **Throughput continuo de telemetría** | **120 req/s** ($600 \div 5\text{ s}$) | Flujo constante de ingesta en horario operativo. |
| **Picos de telemetría estimados (5x)** | **600 req/s** | Picos de tráfico en horas pico de entrega. |
| **Eventos transaccionales de negocio/día** | 75.000 eventos/día | 15.000 envíos $\times$ 5 transiciones de estado promedio. |
| **Throughput medio transaccional** | **~2 a 5 ops/s** | Operaciones CRUD y cambios de estado sobre PostgreSQL. |
| **Observadores concurrentes en vivo** | 600 a 1.200 clientes | 1 a 2 clientes siguiendo envíos en tránsito por cadete activo. |
| **Restricción de costo de mapas** | Máx. 5 consultas por envío | $0$ consultas por reporte de telemetría. Facturación por request en API externa. |

---

## 2. Escenarios de Calidad (SEI / Bass, Clements, Kazman)

Cada requerimiento no funcional se formaliza mediante la estructura canónica de seis partes:
1. **Fuente del estímulo (*Source*):** Entidad interna o externa que genera la condición.
2. **Estímulo (*Stimulus*):** La acción, solicitud o falla que arriba al sistema.
3. **Artefacto (*Artifact*):** Componente, subsistema o entorno que recibe el estímulo.
4. **Entorno (*Environment*):** Condiciones operativas del sistema al momento del estímulo.
5. **Respuesta (*Response*):** Comportamiento esperado y acciones que ejecuta la arquitectura.
6. **Medida de respuesta (*Response Measure*):** Métrica cuantitativa, objetiva y verificable.

---

### NFR-1: Tiempo Real / Latencia (Atributo Estrella)

#### Escenario 1.1: Propagación de Cambio de Estado en Vivo (Push al Cliente)
* **Fuente del estímulo:** Operador (al asignar) o Cadete (al transicionar estado: `retirado`, `en camino`, `entregado`).
* **Estímulo:** Envío de comando vía API REST (`PATCH /envios/{id}/estado` o `POST /envios/{id}/asignar`).
* **Artefacto:** Core de Envíos, Message Broker (RabbitMQ), Gateway/BFF y conexión en vivo (SSE/WebSocket) con el cliente.
* **Entorno:** Operación normal con hasta 1.200 clientes con sesión de seguimiento activa.
* **Respuesta:** El servicio persiste la transición de estado, publica el evento de dominio al broker y el Gateway propaga el cambio hacia la sesión abierta del cliente final sin requerir polling HTTP por parte del frontend.
* **Medida de respuesta:** 
  - Latencia extremo a extremo $\le 2{,}0\text{ s}$ en el percentil 95 ($p95$).
  - Latencia máxima $\le 4{,}0\text{ s}$ en el percentil 99 ($p99$).

#### Escenario 1.2: Ingesta de Telemetría GPS de Cadetes
* **Fuente del estímulo:** Aplicación móvil de cadetes (600 emisores concurrentes).
* **Estímulo:** Ping periódico de coordenadas GPS (frecuencia: $0{,}2\text{ Hz}$ por cadete; carga agregada: 120 req/s).
* **Artefacto:** Ingestion Gateway / Pipeline de Telemetría y almacenamiento en memoria/caché volátil de última posición.
* **Entorno:** Operación continua, soportando ráfagas de hasta 600 req/s.
* **Respuesta:** Recepción, validación mínima de esquema, actualización en memoria de la última posición conocida del cadete y confirmación HTTP `202 Accepted` al dispositivo móvil, desacoplando esta ingesta de la base de datos relacional transaccional.
* **Medida de respuesta:** 
  - Tiempo de confirmación HTTP al dispositivo $\le 200\text{ ms}$ ($p95$) y $\le 400\text{ ms}$ ($p99$) bajo régimen de 120 req/s.
  - Tasa de error HTTP 5xx $< 0{,}01\%$.

---

### NFR-2: Modificabilidad / Extensibilidad (Atributo Estrella)

#### Escenario 2.1: Incorporación de Nuevos Módulos Funcionales Autónomos
* **Fuente del estímulo:** Nuevos equipos de desarrollo (Facturación automática, Premios para cadetes, Analítica operativa).
* **Estímulo:** Solicitud de incorporación de un nuevo módulo al ecosistema productivo.
* **Artefacto:** Arquitectura de mensajería (RabbitMQ Topic Exchange) y microservicio Core de Envíos.
* **Entorno:** Sistema en producción con tráfico activo sin interrupción del servicio (zero-downtime).
* **Respuesta:** El nuevo módulo se subscribe a tópicos y colas dedicadas en el Message Broker para consumir eventos (`EnvioCreado`, `EnvioAsignado`, `EstadoActualizado`). El Core de Envíos no requiere modificación de código, cambios de configuración ni redeploy.
* **Medida de respuesta:** 
  - **Cero (0)** líneas de código modificadas en el Core de Envíos y servicios preexistentes.
  - **Cero (0)** minutos de parada de servicio (downtime) en la infraestructura existente durante el deploy del nuevo módulo.
  - Tiempo de integración de infraestructura de mensajería $\le 4$ horas/hombre.

#### Escenario 2.2: Evolución de Esquemas de Eventos y Contratos
* **Fuente del estímulo:** Equipo de Envíos agregando metadatos adicionales al evento de dominio.
* **Estímulo:** Publicación de una versión compatible del evento con nuevos atributos opcionales.
* **Artefacto:** Consumidores de eventos (colas existentes).
* **Entorno:** Operación distribuida entre módulos desarrollados por diferentes equipos.
* **Respuesta:** Los consumidores existentes continúan procesando los eventos ignorando los campos desconocidos (principio de robustez / *tolerante reader*).
* **Medida de respuesta:** Cero roturas de compatibilidad regresiva en consumidores existentes.

---

### NFR-3: Eficiencia de Costos (Restricción Crítica)

#### Escenario 3.1: Aislamiento Estricto de Telemetría respecto a APIs Externas Pagas
* **Fuente del estímulo:** Flujo constante de telemetría de 600 cadetes (≈ 5,2 millones de pings/día).
* **Estímulo:** Recepción de coordenadas geográficas en el servicio de ubicación.
* **Artefacto:** Módulo de Telemetría e Integración con el proveedor externo de Mapas.
* **Entorno:** Operación normal continua.
* **Respuesta:** El pipeline de telemetría distribuye internamente la última posición hacia los clientes conectados mediante identificador de sesión/envío sin invocar servicios de geocodificación reversa ni cálculo de matriz de distancias del proveedor externo.
* **Medida de respuesta:** 
  - **Exactamente 0 consultas** al servicio externo de mapas derivadas de reportes de telemetría GPS.

#### Escenario 3.2: Cuota Máxima de Consultas Externas por Ciclo de Vida de Envío
* **Fuente del estímulo:** Ciclo de vida completo de un envío (creación, asignación, retiro, entrega).
* **Estímulo:** Cambios de estado que demandan validación espacial o cálculo de ETA.
* **Artefacto:** Adaptador del Servicio Externo de Mapas / Core de Envíos.
* **Entorno:** 15.000 envíos procesados en el día.
* **Respuesta:** El sistema invoca al proveedor externo únicamente en hitos discretos y memoiza/cachea resultados estáticos:
  1. Geocodificación de dirección de retiro (1 llamada al crear).
  2. Geocodificación de dirección de entrega (1 llamada al crear).
  3. Estimación inicial de ruta y ETA (1 llamada al asignar).
  4. Recálculo de ETA ante inicio de trayecto (1 llamada al pasar a `en camino`).
* **Medida de respuesta:** 
  - Promedio diario $\le 4{,}0$ llamadas a mapas por envío completado.
  - Límite duro estricto $\le 5{,}0$ llamadas a mapas por envío.
  - Volumen diario agregado $\le 75.000$ peticiones externas (reduciendo el costo en más de un 98% respecto al modelo acoplado a telemetría).

---

### NFR-4: Escalabilidad Horizontal

#### Escenario 4.1: Absorción de Picos de Demanda y Crecimiento de Flota
* **Fuente del estímulo:** Duplicación de flota (1.200 cadetes) o picos de tráfico de 600 req/s.
* **Estímulo:** Incremento de 5x en la tasa de reportes de GPS y 2x en la tasa de creación de envíos.
* **Artefacto:** Gateway de Telemetría, Brokers de Mensajería y Workers de background.
* **Entorno:** Picos de alta demanda horaria (ej. mediodía o días de lluvia).
* **Respuesta:** La capa sin estado (*stateless*) escala horizontalmente instanciando réplicas de contenedores sin requerir migración de esquema de base de datos ni modificaciones arquitectónicas. El broker absorbe el exceso de carga transitoria sin rechazar mensajes.
* **Medida de respuesta:** 
  - La latencia $p95$ de confirmación de telemetría se conserva $\le 300\text{ ms}$.
  - Pérdida de mensajes o eventos transaccionales: $0\%$ (cero pérdida).

---

### NFR-5: Disponibilidad y Resiliencia (Fault Tolerance)

#### Escenario 5.1: Degradación Elegante ante Caída del Servicio Externo de Mapas
* **Fuente del estímulo:** Falla de red, caída de proveedor o agotamiento de cuota en el Servicio de Mapas.
* **Estímulo:** Timeout ($\ge 2\text{ s}$) o respuesta HTTP 5xx al solicitar estimación de tiempo o geocodificación.
* **Artefacto:** Circuit Breaker / Fallback en el cliente HTTP del Servicio de Mapas.
* **Entorno:** Creación de envíos o consulta de ETA en ejecución.
* **Respuesta:** El Circuit Breaker se abre tras 3 fallas consecutivas; el sistema conmuta a un cálculo de respaldo euclidiano/heurístico local para el ETA y permite continuar la operación logística marcando el ETA como "estimado aproximado". Si falla la geocodificación inicial de dirección, se responde con un error estructurado RFC 9457 (Problem Details) con código 503 sin bloquear hilos del servidor.
* **Medida de respuesta:** 
  - El Core de Envíos preserva una disponibilidad $\ge 99{,}5\%$ mensual.
  - Tiempo de apertura del Circuit Breaker $\le 3$ fallos consecutivos; tiempo de intento de recuperación (*half-open*) = 30 segundos.

#### Escenario 5.2: Aislamiento de Fallas en Módulos Consumidores Secundarios
* **Fuente del estímulo:** Caída imprevista del módulo de Facturación o Analítica.
* **Estímulo:** El consumidor deja de procesar mensajes de su cola asignada.
* **Artefacto:** Broker RabbitMQ y Core de Envíos.
* **Entorno:** Operaciones transaccionales en curso.
* **Respuesta:** La cola del servicio caído retiene los eventos con persistencia en disco sin desbordar la memoria. Las operaciones primarias (creación, asignación y entrega de envíos) continúan ejecutándose sin degradación de rendimiento. Al restablecerse el módulo, este drena la cola sin inconsistencias.
* **Medida de respuesta:** 
  - Impacto en disponibilidad de creación y asignación de envíos: **0% de degradación**.
  - Tasa de pérdida de eventos encolados: **0%**.

---

### NFR-6: Seguridad y Control de Acceso (RBAC / OIDC)

#### Escenario 6.1: Autorización Basada en Roles e Identidad Verificada
* **Fuente del estímulo:** Usuario final (Cliente, Cadete u Operador) interactuando con las APIs.
* **Estímulo:** Petición HTTP a un endpoint protegido (`POST /envios/{id}/asignar`, `PATCH /envios/{id}/estado`, `GET /envios`).
* **Artefacto:** Middleware de Autenticación/Autorización (validación de tokens JWT emitidos por proveedor OIDC).
* **Entorno:** Operación general.
* **Respuesta:** El sistema verifica firma, emisor, caducidad y roles del JWT:
  - Asignar envíos (`/asignar`): rol estricto `operador`.
  - Actualizar estado (`/estado`): rol estricto `cadete`, restringido exclusivamente al envío asignado a su propio identificador (`sub`).
  - Consultar envío: clientes acceden únicamente a envíos vinculados a su cuenta.
  Peticiones sin token devuelven HTTP 401; peticiones con rol o permisos insuficientes devuelven HTTP 403 con RFC 9457.
* **Medida de respuesta:** 
  - $100\%$ de accesos no autorizados bloqueados en suites de prueba de seguridad.
  - Sobrecarga computacional de validación criptográfica del JWT $\le 5\text{ ms}$ por request.

---

### NFR-7: Confiabilidad, Idempotencia y Consistencia

#### Escenario 7.1: Reintentos de Red en Dispositivos Móviles de Cadetes
* **Fuente del estímulo:** Cadete en zona de cobertura intermitente.
* **Estímulo:** Envío duplicado del mismo comando de transición de estado con clave de idempotencia (`Idempotency-Key` o mismo estado previo).
* **Artefacto:** API Core de Envíos y PostgreSQL (tabla de estados e historial).
* **Entorno:** Pérdida y reconexión de conectividad 4G.
* **Respuesta:** El servicio detecta la duplicación: no inserta registros redundantes en el historial de eventos ni publica eventos repetidos al broker. Devuelve la misma respuesta de éxito previa (`200 OK`) o `409 Conflict` si la máquina de estados prohíbe la transición requerida.
* **Medida de respuesta:** 
  - Cero duplicaciones en la base de datos y en los eventos de dominio ante múltiples recepciones idénticas.

---

## 3. Matriz de Trazabilidad: Decisiones Tácticas vs. NFRs

| Decisión Arquitectónica / Táctica | NFR Principal | NFR Secundario | Compromiso / Trade-off Asumido |
| :--- | :--- | :--- | :--- |
| **Broker de Mensajería (RabbitMQ Topic Exchange)** | **NFR-2** (Extensibilidad) | **NFR-5** (Resiliencia) | Complejidad operativa y consistencia eventual entre módulos. |
| **Separación de Telemetría (Memoria/Caché) vs. Envíos (Postgres)** | **NFR-1** (Tiempo Real) | **NFR-4** (Escalabilidad) | Se prescinde del almacenamiento histórico persistente de pings GPS. |
| **Cache y Llamadas en Hitos al Servicio de Mapas** | **NFR-3** (Costo) | **NFR-1** (Tiempo Real) | Las rutas entre hitos son estimadas; no se recalculan por cada ping. |
| **Autenticación Descentralizada con JWT (OIDC)** | **NFR-6** (Seguridad) | **NFR-4** (Escalabilidad) | Validación local sin consulta síncrona al Identity Provider en cada request. |
| **Circuit Breaker + Fallback Heurístico para Mapas** | **NFR-5** (Disponibilidad) | **NFR-3** (Costo) | En modo degradado se brinda un ETA aproximado basado en distancia euclidiana. |
