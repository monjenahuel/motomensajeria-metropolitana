# Web del Cliente (React SPA) — Motomensajería Metropolitana
**Responsable:** Ezequiel · Arquitectura de Software 1 (UNAHUR)

Frontend web en **React + Vite** (Stack PERN) para que los clientes soliciten y sigan sus envíos de mensajería en tiempo real.

---

## 1. Características Arquitectónicas

- **Consumo Centralizado vía API Gateway**: No se comunica directamente con Keycloak ni con la base de datos interna. Toda llamada se dirige a `http://localhost:3000`.
- **Autenticación OIDC**: Login mediante el endpoint `/auth/token` del Gateway (emisión de Bearer JWT).
- **Control de Acceso (RBAC)**: Solo lista y gestiona los envíos pertenecientes al usuario cliente autenticado.
- **Trazabilidad en Vivo**: Visualización del historial de auditoría de cada transición de estado (`PENDIENTE` $\rightarrow$ `ASIGNADO` $\rightarrow$ `EN_CAMINO` $\rightarrow$ `ENTREGADO`).
- **Puerto Asignado**: **`5173`** (para no colisionar con otros paneles o aplicaciones del equipo).

---

## 2. Ejecución Local (Desarrollo)

```bash
cd cliente-web
npm install
npm run dev
```

La aplicación estará disponible en [http://localhost:5173](http://localhost:5173).

### Credenciales de Prueba

- **Usuario**: `cliente.demo`
- **Contraseña**: `cliente123`
