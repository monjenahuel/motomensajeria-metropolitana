import { createRemoteJWKSet, jwtVerify, errors } from 'jose';

// Mismo archivo en apigateway y en envios: cada servicio valida el token por su cuenta (zero trust).
const ISSUER = process.env.KEYCLOAK_ISSUER;           // debe coincidir con el "iss" del token (URL pública)
const JWKS_URI = process.env.KEYCLOAK_JWKS_URI;       // claves públicas, por la red interna de Docker
const AUDIENCE = process.env.KEYCLOAK_AUDIENCE ?? 'motomensajeria-api';

if (!ISSUER || !JWKS_URI) {
  throw new Error('Faltan las variables KEYCLOAK_ISSUER y/o KEYCLOAK_JWKS_URI');
}

// Descarga las claves públicas de Keycloak y las cachea; si aparece un "kid" desconocido, vuelve a consultarlas.
const jwks = createRemoteJWKSet(new URL(JWKS_URI));

// Errores con Problem Details (RFC 9457)
export function problem(res, status, title, detail, instance) {
  res.status(status).type('application/problem+json').json({
    type: 'about:blank', title, status, detail, instance,
  });
}

// Middleware: exige un Bearer token válido (firma, issuer, audiencia y expiración).
// Si es válido, deja los datos del usuario en req.user.
export async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    res.set('WWW-Authenticate', 'Bearer realm="motomensajeria"');
    return problem(res, 401, 'No autenticado', 'Falta el token Bearer en el header Authorization.', req.originalUrl);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['RS256'],   // fija el algoritmo: evita ataques de confusión de algoritmo
      clockTolerance: 5,       // segundos de tolerancia por diferencias de reloj
    });
    req.user = {
      id: payload.sub,
      username: payload.preferred_username,
      roles: payload.realm_access?.roles ?? [],
    };
    next();
  } catch (err) {
    // Problema del token (firma, expirado, issuer/audiencia incorrectos, mal formado): 401
    if (err instanceof errors.JOSEError && err.code !== 'ERR_JWKS_TIMEOUT') {
      console.warn(`Token rechazado: ${err.code}`);
      res.set('WWW-Authenticate', 'Bearer realm="motomensajeria", error="invalid_token"');
      return problem(res, 401, 'Token inválido', 'El token es inválido o expiró.', req.originalUrl);
    }
    // No se pudo llegar a Keycloak (red, timeout): no es culpa del cliente
    console.error('No se pudo validar el token:', err);
    problem(res, 503, 'Servicio de identidad no disponible', 'No se pudo verificar el token en este momento.', req.originalUrl);
  }
}

// Middleware: exige que el usuario tenga al menos uno de los roles indicados. Va después de authenticate.
export const requireRole = (...permitidos) => (req, res, next) => {
  if (!req.user.roles.some((rol) => permitidos.includes(rol))) {
    console.warn(`Acceso denegado: ${req.user.username} (${req.user.roles.join(',')}) -> ${req.method} ${req.originalUrl}`);
    return problem(res, 403, 'Acceso denegado', 'Tu rol no permite realizar esta acción.', req.originalUrl);
  }
  next();
};
