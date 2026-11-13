# Motomensajería Metropolitana — Escenario 3B
**Arquitectura de Software 1 · UNAHUR**

Sistema de logística urbana implementado con **Microservicios**, **Arquitectura Orientada a Eventos (EDA)** y **Autenticación Centralizada OIDC (Keycloak)**.

---

## 🏗️ Arquitectura del Sistema

```
                      CLIENTE / POSTMAN / NAVEGADOR
                                    │
            ┌───────────────────────┼───────────────────────┐
            │ :8081                 │ :3000                 │ :8080
            ▼                       ▼                       ▼
     ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
     │  Keycloak   │         │ API Gateway │         │ Swagger UI  │
     │  (OIDC/JWT) │         │  (Express)  │         │  (OpenAPI)  │
     └──────┬──────┘         └──────┬──────┘         └─────────────┘
            │                       │
      (red kc-net)                  │ Token Bearer + Proxy
            │                       ▼
     ┌──────┴──────┐         ┌─────────────┐
     │ keycloak-db │         │   envios    │
     │(PostgreSQL) │         │ (Microserv.)│
     └─────────────┘         └──────┬──────┘
                                    │
                     ┌──────────────┴────────────────────────┐
                     │                                       │
                     ▼                                       ▼
              ┌─────────────┐                         ┌─────────────┐
              │  envios-db  │                         │  rabbitmq   │
              │(PostgreSQL) │                         │(Topic Exch.)│
              └─────────────┘                         └─────────────┘
```

### Componentes y Roles
1. **Keycloak (`:8081`)**: Servidor de identidad OIDC con realm `motomensajeria`. Emite tokens JWT con roles (`cliente`, `cadete`, `operador`, `administrador`).
2. **API Gateway (`:3000`)**: Punto de entrada unificado. Valida la firma del token Bearer mediante JWKS y reenvía las peticiones al microservicio correspondiente.
3. **envios (`:3000` interno)**: Microservicio transaccional del dominio de envíos. Valida permisos finos por recurso (Zero Trust), persiste transiciones de estado en PostgreSQL y emite eventos de dominio hacia RabbitMQ.
4. **RabbitMQ (`:5672` / UI `:15672`)**: Broker de eventos con Topic Exchange `motomensajeria.events` para desacoplamiento y extensibilidad (NFR-2).
5. **envios-db (`:5432`)**: Base de datos relacional PostgreSQL con tabla de envíos e historial de auditoría de estados (NFR-7).
6. **Swagger UI (`:8080`)**: Documentación interactiva del contrato `openapi.yaml`.
7. **Tracking (`:3002`)**: Microservicio NestJS de posiciones en tiempo real (SSE). Guarda la última ubicación de cada cadete en Redis con TTL y la distribuye por Pub/Sub, lo que permite escalar instancias horizontalmente. Consume eventos `envio.asignado` y `envio.estado_actualizado` desde RabbitMQ para mantener su proyección de asignaciones; el alta y la baja reales las gestiona el módulo Operador del MS de Envíos.
8. **tracking-redis (`:6379` interno)**: Estado vivo del tracking (sin persistencia). Cada posición expira a los 30 s si el cadete deja de reportar.
9. **Simulador**: Genera reportes GPS de cadetes cada 5 s para la demo (25 por defecto; configurable con `SIM_CADETES`, por ejemplo `600` para la prueba de carga).
10. **Frontend del Operador (`:5173`)**: Aplicación React (Vite) con login contra Keycloak vía Gateway. Permite listar y filtrar envíos, asignarlos a un cadete, liberar asignaciones, consultar el historial y ver el mapa en vivo.

---

## 🚀 Inicio Rápido

### 1. Preparar variables de entorno
```bash
cp .env.example .env
```

### 2. Levantar el stack completo
```bash
docker compose up -d --build
```
> *Nota:* En el primer arranque, Keycloak importa el realm automáticamente (`realm-export.json`). Tarda aproximadamente 30 a 45 segundos en estar listo (`healthy`).

### 3. Verificar estado
```bash
docker compose ps
```

### Tracking en tiempo real
El stack incluye el microservicio de Tracking y su simulador de cadetes:

- **Panel del operador:** [http://localhost:3002](http://localhost:3002) — todos los cadetes en el mapa y métricas de latencia.
- **Vista del cliente:** [http://localhost:3002/cliente.html?envio=01a1a901-5800-7000-8000-000000000001](http://localhost:3002/cliente.html?envio=01a1a901-5800-7000-8000-000000000001) — solo el seguimiento de ese envío. Requiere que el envío esté asignado a un cadete desde el módulo Operador (ver más abajo).
- **API a través del gateway:** `http://localhost:3000/tracking/...` (por ejemplo, `http://localhost:3000/tracking/cadetes`). El gateway hace streaming de las respuestas SSE.
- **Módulo Operador vía gateway:** `http://localhost:3000/operador/asignaciones` (requiere token con rol `operador` o `administrador`).
- **API directa al microservicio:** `http://localhost:3002/tracking/metrics`.
- **Puerto interno:** el contenedor `tracking` escucha en `3000` (igual que `envios`); el host lo publica en `3002` para no chocar con el API Gateway. Se puede cambiar con `TRACKING_PORT`.

**Formato de los datos simulados:** el simulador usa los mismos identificadores que producción. El primer cadete es el usuario real `cadete.demo` y el resto `cadete.sim.002`, `cadete.sim.003`, etc. (usernames de Keycloak). Solo reporta posiciones (`cadeteId`, `lat`, `lng`, `rumbo`, `ts`); las asignaciones envío ↔ cadete se crean desde el módulo Operador.

**Módulo Operador (asignaciones):** el MS de Envíos es el dueño de las asignaciones. Persiste en PostgreSQL y publica el evento `envio.asignado`; Tracking se limita a consumirlo.

- `PATCH /envios/{id}/asignar` → caso de uso oficial del operador.
- `GET /operador/asignaciones` → envíos con cadete asignado.
- `POST /operador/asignaciones` → asigna con `{ "envioId": "...", "mensajero": "cadete.demo" }`.
- `DELETE /operador/asignaciones/{envioId}` → libera una asignación en estado `ASIGNADO` y deja el envío `PENDIENTE`.

**Módulo Cadete:** el cadete autenticado solo ve los envíos en los que `mensajero` coincide con su username. Los cambios de estado se persisten con su historial y publican `envio.estado_actualizado`.

- `GET /cadete/envios` → envíos asignados al cadete (incluye los finalizados).
- `GET /cadete/envios/{id}` → datos básicos de un envío propio (404 si es de otro cadete).
- `PATCH /cadete/envios/{id}/estado` → cambia el estado a `EN_CAMINO`, `ENTREGADO` o `NO_ENTREGADO`.
- `PATCH /envios/{id}/estado` → alias de compatibilidad de la ruta anterior.

**Integración con RabbitMQ:** Tracking consume del exchange `motomensajeria.events` mediante la cola durable `tracking.envios`:
- `envio.asignado` → guarda la asignación envío ↔ cadete en Redis.
- `envio.estado_actualizado` con estado `PENDIENTE`, `ENTREGADO`, `NO_ENTREGADO` o `CANCELADO` → libera la asignación.
- `envio.entregado` → también libera la asignación si se emite como evento propio.

Por ahora Tracking solo consume eventos; no publica.

Para la prueba de carga del escenario, levantá con `SIM_CADETES=600` (≈120 reportes/s) o cambialo en `.env`.

---

## Frontend del Cadete (`cadete-front`)

Abrí http://localhost:5174 e ingresá con `cadete.demo / cadete123`.
El panel permite consultar los envíos propios (`GET /cadete/envios`), buscar y filtrar
por estado, y actualizar el estado con motivo opcional
(`PATCH /cadete/envios/{id}/estado`). Los estados disponibles son `EN_CAMINO`,
`ENTREGADO` y `NO_ENTREGADO`; los envíos finalizados quedan en modo consulta.
Los datos se actualizan cada 15 segundos y el token se renueva automáticamente.

```bash
sudo docker compose up -d --build cadete-front
```

Para desarrollo local:

```bash
cd cadete-front
npm ci
npm run dev
```

Compose acepta `CADETE_FRONT_PORT` (5174), `APIGATEWAY_URL`
(`http://localhost:3000`) y `CADETE_FRONT_KEYCLOAK_CLIENT_ID` (`motomensajeria-web`).
En desarrollo, usá `VITE_API_URL` y `VITE_KEYCLOAK_CLIENT_ID` en `cadete-front/.env.local`.
Las URL de API se incorporan durante el build. El login utiliza el password grant
de Keycloak habilitado para la demo, con acceso exclusivo al rol `cadete`.

## 🖥️ Frontend del Operador (React)

Con el stack levantado, abrí [http://localhost:5173](http://localhost:5173) e ingresá con `operador.demo / operador123` (o `admin.demo / admin123`).

Casos de uso cubiertos:

- Login con rol `operador` o `administrador` contra Keycloak, a través de `POST /auth/token` del gateway.
- Ver todos los envíos, con búsqueda y filtro por estado.
- Asignar un envío `PENDIENTE` a un cadete (`PATCH /envios/{id}/asignar`), con sugerencias de cadetes que están reportando posiciones.
- Liberar asignaciones en estado `ASIGNADO` (`DELETE /operador/asignaciones/{envioId}`).
- Ver las asignaciones vigentes y los envíos finalizados como historial (`GET /operador/asignaciones`).
- Consultar el detalle de un envío con su historial de estados (`GET /envios/{id}`).
- Ver el mapa en vivo embebido desde Tracking (`:3002`).
- Actualización automática cada 15 s y renovación automática del token.

**Desarrollo local:**

```bash
cd operador-front
npm install
npm run dev
```

Variables de build (también configurables en `.env` para Compose):

| Variable | Default | Uso |
| :--- | :--- | :--- |
| `VITE_API_URL` / `APIGATEWAY_URL` | `http://localhost:3000` | API Gateway |
| `VITE_TRACKING_URL` / `OPERADOR_FRONT_TRACKING_URL` | `http://localhost:3002` | Panel de Tracking embebido |
| `VITE_KEYCLOAK_CLIENT_ID` / `OPERADOR_FRONT_KEYCLOAK_CLIENT_ID` | `motomensajeria-web` | Cliente público de Keycloak |
| `OPERADOR_FRONT_PORT` | `5173` | Puerto publicado por el contenedor nginx |

> El login usa el password grant a través del gateway para simplificar la demo. En producción corresponde Authorization Code + PKCE.

---

## 🔑 Credenciales y Usuarios de Prueba

Todos los usuarios están precargados en Keycloak con realm `motomensajeria`:

| Rol | Username | Password | Permisos |
| :--- | :--- | :--- | :--- |
| **Operador** | `operador.demo` | `operador123` | Asignar envíos a cadetes, ver todos los envíos |
| **Cadete** | `cadete.demo` | `cadete123` | Ver sus envíos asignados y actualizar su estado |
| **Cliente** | `cliente.demo` | `cliente123` | Crear envíos, consultar únicamente sus envíos |
| **Administrador** | `admin.demo` | `admin123` | Control total del sistema |

---

## 🔓 Autenticación desde Swagger UI

Ya no hace falta copiar un token a mano:

1. Abrí [http://localhost:8080](http://localhost:8080).
2. Clic en **Authorize**.
3. En **OAuth2** ingresá:
   - **username:** por ejemplo `operador.demo`
   - **password:** `operador123`
   - **client_id:** `motomensajeria-web`
   - **client_secret:** dejarlo vacío
4. Clic en **Authorize**.

Swagger UI pide el token al gateway (`POST /auth/token`), el gateway lo solicita a Keycloak por la red interna y Swagger lo aplica automáticamente a las peticiones protegidas.

> El password grant está habilitado en el cliente público `motomensajeria-web` para facilitar la demo. En producción conviene usar Authorization Code + PKCE.

---

## 🧪 Demostración del Caso de Uso Mínimo

> **Caso de Uso:** *Un operador asigna un envío a un cadete y se emite el evento de dominio.*

### 1. Obtener Token JWT del Operador
```bash
TOKEN_OPERADOR=$(curl -s -X POST "http://localhost:8081/realms/motomensajeria/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=motomensajeria-web" \
  -d "grant_type=password" \
  -d "username=operador.demo" \
  -d "password=operador123" | jq -r .access_token)
```
*(En Windows PowerShell: `$TOKEN_OPERADOR = (Invoke-RestMethod -Uri "http://localhost:8081/realms/motomensajeria/protocol/openid-connect/token" -Method Post -Body @{ client_id="motomensajeria-web"; grant_type="password"; username="operador.demo"; password="operador123" }).access_token`)*

### 2. Asignar el envío `01a1a901-5800-7000-8000-000000000001` al cadete `cadete.demo`
```bash
curl -X PATCH http://localhost:3000/envios/01a1a901-5800-7000-8000-000000000001/asignar \
  -H "Authorization: Bearer $TOKEN_OPERADOR" \
  -H "Content-Type: application/json" \
  -d '{ "mensajero": "cadete.demo" }'
```

**Respuesta esperada:**
```json
{
  "id": "01a1a901-5800-7000-8000-000000000001",
  "origen": "Av. Corrientes 1000, CABA",
  "destino": "Av. Cabildo 2000, CABA",
  "estado": "ASIGNADO",
  "cliente": "cliente.demo",
  "mensajero": "cadete.demo",
  "operador_asignador": "operador.demo",
  "consultas_mapas_realizadas": 3
}
```

### 3. Verificar el Evento en RabbitMQ
Ingresá al panel de gestión de RabbitMQ en [http://localhost:15672](http://localhost:15672) (usuario `guest` / clave `guest`):
- En la pestaña **Exchanges**, seleccioná `motomensajeria.events`.
- Observá la publicación del evento `envio.asignado`.

### 4. Consultar el Detalle con Historial de Auditoría
```bash
curl -H "Authorization: Bearer $TOKEN_OPERADOR" http://localhost:3000/envios/01a1a901-5800-7000-8000-000000000001
```
Devolverá el envío con su array `historial` detallando quién hizo la transición y en qué fecha.

---

## 🛵 Flujo del Cadete

El cadete usa el módulo Cadete del mismo MS de Envíos. Con el envío anterior ya asignado a `cadete.demo`:

### 1. Obtener Token JWT del Cadete
```bash
TOKEN_CADETE=$(curl -s -X POST "http://localhost:8081/realms/motomensajeria/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=motomensajeria-web" \
  -d "grant_type=password" \
  -d "username=cadete.demo" \
  -d "password=cadete123" | jq -r .access_token)
```

### 2. Listar los envíos asignados
```bash
curl -H "Authorization: Bearer $TOKEN_CADETE" http://localhost:3000/cadete/envios
```

### 3. Ver los datos básicos de un envío
```bash
curl -H "Authorization: Bearer $TOKEN_CADETE" \
  http://localhost:3000/cadete/envios/01a1a901-5800-7000-8000-000000000001
```

### 4. Cambiar el estado del envío
```bash
curl -X PATCH http://localhost:3000/cadete/envios/01a1a901-5800-7000-8000-000000000001/estado \
  -H "Authorization: Bearer $TOKEN_CADETE" \
  -H "Content-Type: application/json" \
  -d '{ "estado": "EN_CAMINO", "motivo": "Retirado en origen y en tránsito" }'
```

Estados permitidos: `EN_CAMINO`, `ENTREGADO`, `NO_ENTREGADO`. Cada cambio queda en el historial y publica `envio.estado_actualizado`; al llegar a un estado final, Tracking libera la asignación y el envío deja de aparecer en el mapa.

---

## 🗺️ Servicios de Mapas y Notificaciones

Dos módulos nuevos que se suman al stack **sin tocar Envíos ni Tracking**: se suscriben al mismo exchange
(`motomensajeria.events`) y consumen los eventos que Envíos ya publica. Lo único que se agregó fuera de sus carpetas
fue la ruta `/notificaciones` en el API Gateway y los servicios en `docker-compose.yml`.

| Carpeta | Qué es |
|---|---|
| `mock-mapas/` | **Sistema externo simulado.** Imita Nominatim (`/search`) y OSRM (`/route/v1/driving`), cuenta las consultas y tiene modo falla. Sin dependencias. |
| `mapas/` | **Adaptador de mapas.** Escucha `envio.creado`, `envio.asignado` y `envio.estado_actualizado`; ubica direcciones y estima tiempos, siempre con caché. Si el servicio externo cae, estima por su cuenta. Sin base propia. |
| `notificaciones/` | **Avisos al cliente.** Un aviso por cada cambio relevante. `GET /notificaciones` los expone con la misma autenticación que los otros servicios. |
| `docs/contrato-eventos.md` | Los eventos que existen hoy, quién los publica y quién los consume. |
| `test/flujo.mjs` | Prueba de punta a punta sin Docker ni RabbitMQ (19 verificaciones). |

### Endpoints

- `GET /notificaciones` (Gateway `:3000`) → avisos del cliente autenticado. El operador y el administrador ven todos.
  Acepta `?envioId=<uuid>` y `?desde=<id>` para polling. Responde `401` sin token y `403` para el rol `cadete`.
- `GET :4000/stats` → consultas realizadas al servicio externo de mapas y estado del modo falla.
- `POST :4000/stats/reset` → reinicia el contador de consultas.
- `POST :4000/admin/falla` con `{ "activo": true|false }` → simula que el servicio de mapas está caído.

### Probarlo con el flujo real

Los eventos los publica Envíos de verdad: no hace falta mandar mensajes a mano.

```bash
tok() { curl -s -X POST localhost:3000/auth/token -d "grant_type=password&client_id=motomensajeria-web&username=$1&password=$2" | jq -r .access_token; }
C=$(tok cliente.demo cliente123); O=$(tok operador.demo operador123); K=$(tok cadete.demo cadete123)

# 1) El cliente crea un envío -> Mapas ubica las direcciones; Notificaciones: "Recibimos tu pedido"
ID=$(curl -s -X POST localhost:3000/envios -H "Authorization: Bearer $C" -H "content-type: application/json" \
  -d '{"origen":"Av. Corrientes 1000, CABA","destino":"Av. Cabildo 2000, CABA"}' | jq -r .id)

# 2) El operador lo asigna -> ETA estimado y aviso "asignado"
curl -s -X POST localhost:3000/operador/asignaciones -H "Authorization: Bearer $O" -H "content-type: application/json" \
  -d "{\"envioId\":\"$ID\",\"mensajero\":\"cadete.demo\"}"

# 3) El cadete sale a entregar -> ETA nuevo y aviso "en camino"
curl -s -X PATCH localhost:3000/cadete/envios/$ID/estado -H "Authorization: Bearer $K" -H "content-type: application/json" \
  -d '{"estado":"EN_CAMINO"}'

# 4) El cliente consulta sus avisos
curl -s localhost:3000/notificaciones -H "Authorization: Bearer $C" | jq

docker compose logs mapas notificaciones     # se ve todo el recorrido
curl -s localhost:4000/stats                  # consultas al "servicio externo": 3 por envío
```

También se ve en la consola de RabbitMQ (`http://localhost:15672`, `guest` / `guest`): colas `mapas.envios` y `q.notificaciones`.

### Probar la lógica sin Docker

```bash
cd notificaciones && npm install && cd ..
node test/flujo.mjs
```

### Evidencia para la verificación de NFRs

**NFR-3 · Costo (≤ 5 consultas por envío, 0 por reporte de ubicación)**
```bash
curl -X POST localhost:4000/stats/reset
# crear y asignar varios envíos (pasos 1 y 2 de arriba)
curl localhost:4000/stats        # consultas.total ≈ 3 por envío
```
Los reportes de ubicación van a Tracking y nunca pasan por Mapas: el contador no se mueve.

**NFR-5 · Mapas caído (el ETA sale igual, con estimación de respaldo)**
```bash
# crear el envío primero (así queda en la memoria de Mapas) y DESPUÉS activar la falla:
curl -X POST localhost:4000/admin/falla -H "content-type: application/json" -d '{"activo":true}'
# asignar el envío -> el aviso dice "estimación aproximada"
curl -X POST localhost:4000/admin/falla -H "content-type: application/json" -d '{"activo":false}'
```

**NFR-5 · Cae un suscriptor (el núcleo sigue funcionando)**
```bash
docker compose stop notificaciones
# crear, asignar y cambiar estados desde la API: todo responde bien
docker compose start notificaciones
docker compose logs notificaciones      # procesa los eventos que quedaron en la cola
```

### Decisiones y límites a tener presentes

- **El ETA es una simplificación:** ruta origen → destino más 10 minutos de retiro mientras el cadete va a buscar el paquete.
  No usa la posición real del cadete (eso requeriría consultar a Tracking). Mejora posible; va al ADR.
- **Mapas guarda los envíos y la caché en memoria.** Si se reinicia, los envíos ya creados quedan sin ETA hasta que Envíos
  incluya las direcciones en `asignado`/`estado_actualizado` (mejora opcional del contrato).
- **Notificaciones guarda el historial en memoria:** al reiniciarse lo pierde (los eventos pendientes de la cola sí se procesan).
  El canal real (mail, push, SMS) es un log, como corresponde a un sistema simulado.
- **No hay stream en vivo para los avisos:** el frontend puede hacer polling con `GET /notificaciones?desde=<último id>`.
  `EventSource` del navegador no permite enviar el header `Authorization`, así que un stream pediría otra solución.
- **Hoy ningún frontend muestra los avisos.** Se pueden ver con `curl` o en los logs para la demo.
- **Para usar Nominatim/OSRM reales:** hoy `MAPAS_URL` apunta a un único host que expone los dos formatos (lo hace el mock).
  En los servicios reales son **dos hosts distintos** (Nominatim para `/search` y OSRM para `/route/v1/driving`), así que
  habría que separar la configuración en dos variables o poner un proxy delante. No se recomienda para la demo: el público
  de Nominatim limita a 1 consulta por segundo y depende de internet.

---

## 📋 Documentación de Arquitectura y NFRs
- Especificación formal completa de atributos de calidad (Escenarios SEI de 6 partes y matriz de trade-offs): [docs/NFR.md](file:///c:/Users/vicky/Documents/dev/unahur/motomensajeria-metropolitana/docs/NFR.md).
