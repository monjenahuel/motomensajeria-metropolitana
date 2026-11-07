# Broker de Eventos — Motomensajería Metropolitana (Escenario 3B)
**Responsable:** Ezequiel · Arquitectura de Software 1 (UNAHUR)

Infraestructura de mensajería asíncrona basada en **RabbitMQ** con topología declarativa para desacoplamiento y extensibilidad (**NFR-2**).

---

## 1. Topología del Broker

- **Exchange Principal**: `motomensajeria.events` (Tipo: `topic`, Durable)
- **Dead Letter Exchange**: `motomensajeria.dlx` (Tipo: `direct`, Durable)

### Colas y Enrutamiento

| Cola | Propósito / Consumidor | Routing Keys Enlazadas |
| :--- | :--- | :--- |
| `q.notificaciones` | Servicio de Notificaciones (Angel) | `envio.*` |
| `q.tracking` | Servicio de Tracking & Telemetría (Nahuel) | `envio.asignado`, `tracking.*` |
| `q.auditoria` | Registro global de eventos y métricas | `#` (todos los eventos) |
| `q.dead-letter` | Mensajes rechazados o con error no recuperable | `dead-letter` |

---

## 2. Contrato de Mensajería (Envelope Estándar)

Todos los eventos publicados en `motomensajeria.events` deben seguir este formato JSON:

```json
{
  "eventId": "123e4567-e89b-12d3-a456-426614174000",
  "eventType": "envio.creado",
  "timestamp": "2026-11-06T10:00:00.000Z",
  "producer": "servicio-envios",
  "data": {
    "id": 1,
    "numero_seguimiento": "ENV-2026-0001",
    "cliente": "cliente.demo",
    "origen": "Av. Corrientes 1000, CABA",
    "destino": "Av. Cabildo 2000, CABA",
    "estado": "PENDIENTE"
  }
}
```

### Eventos de Dominio Definidos

| Routing Key | Emisor | Disparador / Contenido |
| :--- | :--- | :--- |
| `envio.creado` | Envíos / Web Cliente | Pedido registrado en plataforma |
| `envio.asignado` | Envíos / Operador | Envío asignado a un cadete |
| `envio.estado_actualizado` | Envíos / Cadete | Transición a `EN_CAMINO`, `ENTREGADO`, etc. |
| `tracking.posicion` | Cadete / Telemetría | Coordenadas GPS del cadete en ruta |

---

## 3. Acceso a Consola de Gestión

- **URL**: [http://localhost:15672](http://localhost:15672)
- **Usuario**: `guest`
- **Contraseña**: `guest`
