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
7. **Tracking (`:3002`)**: Microservicio NestJS de posiciones en tiempo real (SSE). Guarda GPS temporal en Redis y proyección durable de asignaciones en su propio PostgreSQL. Consume eventos de RabbitMQ y reconcilia periódicamente con Envíos (fuente de verdad).
8. **tracking-redis (`:6379` interno)**: Estado vivo del tracking (sin persistencia). Cada posición expira según `TRACKING_POS_TTL_S` si el cadete deja de reportar.
9. **tracking-db (interno)**: PostgreSQL exclusivo de Tracking con volumen persistente para asignaciones e inbox de eventos.
10. **Simulador**: Configurado para arrancar con el stack; sus reportes GPS requieren tokens de cadete válidos.
11. **Frontend del Operador (`:5173`)**: Aplicación React (Vite) con login contra Keycloak vía Gateway. Permite listar y filtrar envíos, asignarlos a un cadete, liberar asignaciones, consultar el historial y ver el mapa en vivo.

---

## 🚀 Inicio Rápido

### 1. Preparar variables de entorno
```bash
cp .env.example .env
```
Reemplazá `TRACKING_DB_PASSWORD` y `TRACKING_SYNC_SECRET` por valores aleatorios propios antes de levantar el stack.

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
El stack incluye Tracking y la configuración del simulador de cadetes:

- **Panel del operador:** [http://localhost:3002](http://localhost:3002) — todos los cadetes en el mapa y métricas de latencia.
- **Vista del cliente:** [http://localhost:3002/cliente.html?envio=01a1a901-5800-7000-8000-000000000001](http://localhost:3002/cliente.html?envio=01a1a901-5800-7000-8000-000000000001) — solo el seguimiento de ese envío. Requiere que el envío esté asignado a un cadete desde el módulo Operador (ver más abajo).
- **API a través del gateway:** `http://localhost:3000/tracking/...` (por ejemplo, `http://localhost:3000/tracking/cadetes`). El gateway hace streaming de las respuestas SSE.
- **Módulo Operador vía gateway:** `http://localhost:3000/operador/asignaciones` (requiere token con rol `operador` o `administrador`).
- **API directa al microservicio:** `http://localhost:3002/tracking/metrics`.
- **Puerto interno:** el contenedor `tracking` escucha en `3000` (igual que `envios`); el host lo publica en `3002` para no chocar con el API Gateway. Se puede cambiar con `TRACKING_PORT`.

Tracking lee las asignaciones desde su PostgreSQL, incluso si Redis o Envíos están caídos.
Al iniciar y cada 60 segundos reconcilia en segundo plano con Envíos usando `TRACKING_SYNC_SECRET`;
no consulta Envíos por cada mapa. Si se perdió un evento, la recuperación es eventual.

**Simulador:** Compose intenta arrancarlo con el stack, pero Tracking rechazará sus reportes GPS sin un token válido de cadete. En este checkout falta `simulator/sim.js`; para usarlo hay que incorporar el script y adaptarlo al flujo autenticado.

**Módulo Operador (asignaciones):** el MS de Envíos es el dueño de las asignaciones. Persiste en PostgreSQL y publica el evento `envio.asignado`; Tracking lo consume para actualizar su proyección y la reconcilia periódicamente con Envíos.

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
- `envio.asignado` → guarda la asignación envío ↔ cadete en PostgreSQL de Tracking.
- `envio.estado_actualizado` con estado `PENDIENTE`, `ENTREGADO`, `NO_ENTREGADO` o `CANCELADO` → libera la asignación.
- `envio.entregado` → también libera la asignación si se emite como evento propio.

Por ahora Tracking solo consume eventos; no publica.

Para pruebas de carga, usar clientes con tokens de cadete válidos. Cambiar `SIM_CADETES` por sí solo no habilita el reporte sin autenticación.

---

## Frontend del Cadete (`cadete-front`)

Abrí http://localhost:5174 e ingresá con `cadete.demo / cadete123`.
El panel permite consultar los envíos propios (`GET /cadete/envios`), buscar y filtrar
por estado, y actualizar el estado con motivo opcional
(`PATCH /cadete/envios/{id}/estado`). Los estados disponibles son `EN_CAMINO`,
`ENTREGADO` y `NO_ENTREGADO`; los envíos finalizados quedan en modo consulta.
Los datos se actualizan cada 15 segundos y el token se renueva automáticamente.
Mientras el panel está abierto en primer plano, solicita permiso de ubicación al navegador
y envía automáticamente la posición real al Gateway cada 5 segundos con su token Bearer.
El Gateway valida el rol `cadete`, obtiene el username del token y reenvía el reporte a Tracking.
Al pasar a segundo plano o cerrar sesión deja de enviar. El navegador requiere HTTPS o
`localhost` para acceder al GPS; en una pestaña en segundo plano no se garantiza seguimiento.

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

## 📋 Documentación de Arquitectura y NFRs
- Especificación formal completa de atributos de calidad (Escenarios SEI de 6 partes y matriz de trade-offs): [docs/NFR.md](file:///c:/Users/vicky/Documents/dev/unahur/motomensajeria-metropolitana/docs/NFR.md).
