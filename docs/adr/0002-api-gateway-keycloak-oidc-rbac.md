# ADR-0002: API Gateway único y autenticación federada con Keycloak (OIDC/JWKS + RBAC)

- **Estado:** Aceptada
- **NFRs vinculados:** NFR-6 (Seguridad / RBAC y OIDC)

## Contexto
El sistema expone tres aplicaciones web diferenciadas por rol (`operador-front` en `:5173`, `cadete-front` en `:5174`, `cliente-web` en `:5175`) además de Swagger UI (`:8080`). Si cada frontend hablara directamente con cada microservicio y con Keycloak, se duplicaría la configuración de CORS, se expondrían topologías internas y cada servicio tendría que gestionar credenciales o flujos de tokens heterogéneos.

## Decisión
Establecer un **API Gateway** (`apigateway/`, puerto `:3000`) como único punto de entrada HTTP/SSE para clientes externos, respaldado por **Keycloak** (`keycloak/realm-export.json`, realm `motomensajeria`) como proveedor de identidad OIDC:

1. **Autenticación centralizada en `/auth/token` y `/auth/me`:** las SPAs obtienen y refrescan tokens JWT mediante el Gateway sin acoplarse directamente a los endpoints internos de Keycloak.
2. **Validación stateless por JWKS + RBAC en dos capas:** el Gateway verifica firma, emisor y roles (`administrador`, `operador`, `cadete`, `cliente`) antes de proxear hacia `envios`, `tracking` o `notificaciones` (incluyendo el stream SSE `GET /notificaciones/stream` para todos los roles autenticados), y los microservicios revalidan permisos finos (p. ej., propiedad del envío por `cliente` o `cadete`).
3. **Sesión de mapas por Cookie `HttpOnly`:** para iframes y `EventSource` (SSE) que no permiten cabecera `Authorization`, el Gateway provee `POST/DELETE /mapas/sesion` emitiendo la cookie `mapa_token` (`HttpOnly; SameSite=Lax; Path=/mapas`) sin exponer el JWT en la URL.
4. **Errores estandarizados:** respuestas de error bajo RFC 7807 (`application/problem+json`).

## Alternativas evaluadas
1. **Validación exclusiva en el Gateway sin defensa en profundidad:** descartada porque impediría validar ownership por recurso en `envios` o proteger reportes GPS directos en `tracking` (`CadeteAuthGuard`).
2. **JWT en query string para SSE e iframes:** descartada por riesgo de filtración de tokens en logs, historial del navegador y cabeceras `Referer`.

## Consecuencias
- **Positivas:**
  - Topología interna oculta: `envios`, `tracking`, `mapas` y `notificaciones` no necesitan exponer puertos públicos en producción.
  - Política CORS uniforme para los tres frontends y soporte de credenciales para mapas embebidos.
- **Negativas / Riesgos:**
  - El Gateway es un punto crítico de entrada; debe mantenerse liviano (sin lógica de negocio) y stateless para poder replicarse horizontalmente.
