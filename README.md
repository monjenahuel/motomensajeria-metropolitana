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

---

## 🔑 Credenciales y Usuarios de Prueba

Todos los usuarios están precargados en Keycloak con realm `motomensajeria`:

| Rol | Username | Password | Permisos |
| :--- | :--- | :--- | :--- |
| **Operador** | `operador.demo` | `operador123` | Asignar envíos a cadetes, ver todos los envíos |
| **Cadete** | `cadete.demo` | `cadete123` | Actualizar estado de sus envíos asignados |
| **Cliente** | `cliente.demo` | `cliente123` | Crear envíos, consultar únicamente sus envíos |
| **Administrador** | `admin.demo` | `admin123` | Control total del sistema |

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

### 2. Asignar el envío 1 al cadete `cadete.demo`
```bash
curl -X PATCH http://localhost:3000/envios/1/asignar \
  -H "Authorization: Bearer $TOKEN_OPERADOR" \
  -H "Content-Type: application/json" \
  -d '{ "mensajero": "cadete.demo" }'
```

**Respuesta esperada:**
```json
{
  "id": 1,
  "numero_seguimiento": "ENV-2026-0001",
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
curl -H "Authorization: Bearer $TOKEN_OPERADOR" http://localhost:3000/envios/1
```
Devolverá el envío con su array `historial` detallando quién hizo la transición y en qué fecha.

---

## 📋 Documentación de Arquitectura y NFRs
- Especificación formal completa de atributos de calidad (Escenarios SEI de 6 partes y matriz de trade-offs): [docs/NFR.md](file:///c:/Users/vicky/Documents/dev/unahur/motomensajeria-metropolitana/docs/NFR.md).
