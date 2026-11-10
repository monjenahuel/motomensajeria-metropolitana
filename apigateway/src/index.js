import express from 'express';
import { Readable } from 'node:stream';
import { authenticate, requireRole, problem } from './auth.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// URL interna del microservicio de envíos (nombre del servicio en docker-compose)
const ENVIOS_URL = process.env.ENVIOS_URL ?? 'http://envios:3000';
const TRACKING_URL = process.env.TRACKING_URL ?? 'http://tracking:3000';
const KEYCLOAK_INTERNAL_URL = process.env.KEYCLOAK_INTERNAL_URL ?? 'http://keycloak:8080';
const KC_REALM = process.env.KC_REALM ?? 'motomensajeria';

// Roles de la aplicación (los mismos que en el realm de Keycloak)
const ROLES_APP = ['administrador', 'operador', 'cadete', 'cliente'];

// CORS: las SPA llaman al gateway desde otro origen y necesitan credenciales para el mapa.
app.use((req, res, next) => {
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175').split(',');
  if (origins.includes(req.get('origin'))) {
    res.set('Access-Control-Allow-Origin', req.get('origin'));
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Rutas públicas ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

app.get('/', (req, res) => {
  res.json({
    service: 'api-gateway',
    mensaje: 'API Gateway funcionando. Las rutas /envios requieren un token Bearer.',
    rutas: ['/health', '/auth/token', '/auth/me', '/envios'],
  });
});

// ---------- Rutas de Identidad / Auth ----------
app.post('/auth/token', async (req, res) => {
  const { username, password, grant_type = 'password', refresh_token } = req.body;
  const tokenUrl = `${KEYCLOAK_INTERNAL_URL}/realms/${KC_REALM}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append('client_id', 'motomensajeria-web');
  params.append('grant_type', grant_type);

  if (grant_type === 'password') {
    if (!username || !password) {
      return problem(res, 400, 'Datos incompletos', 'Se requieren username y password para autenticarse.', req.originalUrl);
    }
    params.append('username', username);
    params.append('password', password);
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return problem(res, 400, 'Datos incompletos', 'Se requiere refresh_token.', req.originalUrl);
    }
    params.append('refresh_token', refresh_token);
  }

  try {
    const respuesta = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await respuesta.json();
    if (!respuesta.ok) {
      return problem(res, respuesta.status, 'Error de autenticación', data.error_description || data.error || 'Credenciales inválidas.', req.originalUrl);
    }

    res.json(data);
  } catch (err) {
    console.error('[Auth Error]', err.message);
    problem(res, 502, 'Servicio de identidad no disponible', 'No se pudo contactar al servidor de autenticación.', req.originalUrl);
  }
});

app.get('/auth/me', authenticate, (req, res) => {
  res.json({
    sub: req.user.sub,
    username: req.user.preferred_username,
    email: req.user.email,
    roles: req.user.realm_access?.roles ?? [],
  });
});

// ---------- Reenvío a envíos ----------
// Reenvía método, body y token al microservicio. La autorización fina por rol (y por dueño del envío)
// la vuelve a aplicar el propio microservicio.
async function reenviar(req, res) {
  try {
    const init = { method: req.method, headers: { authorization: req.headers.authorization } };
    const tieneBody = !['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length > 0;
    if (tieneBody) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }
    const respuesta = await fetch(`${ENVIOS_URL}${req.originalUrl}`, init);
    res.status(respuesta.status);
    const tipo = respuesta.headers.get('content-type');
    if (tipo) res.type(tipo);
    const location = respuesta.headers.get('location');
    if (location) res.set('Location', location);
    res.send(Buffer.from(await respuesta.arrayBuffer()));
  } catch (err) {
    console.error(err);
    problem(res, 502, 'Servicio no disponible', 'No se pudo contactar al microservicio de envíos.', req.originalUrl);
  }
}

// El gateway rechaza lo obvio: sin token válido (401) o sin ningún rol de la aplicación (403).
app.use('/envios', authenticate, requireRole(...ROLES_APP), reenviar);

// Módulo Operador: también vive en el MS de Envíos y exige rol operador/administrador.
app.use('/operador', authenticate, requireRole('operador', 'administrador'), reenviar);

// Módulo Cadete: también vive en el MS de Envíos y exige rol cadete.
app.use('/cadete', authenticate, requireRole('cadete'), reenviar);

// ---------- Reenvío a tracking ----------
// Tracking expone REST y SSE. Se hace streaming del body para que los eventos SSE
// lleguen al cliente sin quedar bufferizados en el gateway.
async function reenviarTracking(req, res) {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  // Revalidar permisos en cada reconexión SSE: una reasignación o cambio de
  // dueño no debe dejar abierto indefinidamente un canal autorizado antes.
  const vence = req.params.envioId && req.path.endsWith('/stream')
    ? setTimeout(() => res.end(), 30_000) : null;
  res.on('close', () => { if (vence) clearTimeout(vence); });

  try {
    const init = {
      method: req.method,
      headers: { accept: req.headers.accept ?? '*/*' },
      signal: controller.signal,
    };
    if (req.headers.authorization) init.headers.authorization = req.headers.authorization;

    const tieneBody = !['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length > 0;
    if (tieneBody) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }

    const destino = req.originalUrl.startsWith('/mapas/tracking/')
      ? req.originalUrl.slice('/mapas'.length) : req.originalUrl;
    const respuesta = await fetch(`${TRACKING_URL}${destino}`, init);
    res.status(respuesta.status);

    const tipo = respuesta.headers.get('content-type');
    if (tipo) res.setHeader('Content-Type', tipo);
    const cache = respuesta.headers.get('cache-control');
    if (cache) res.setHeader('Cache-Control', cache);
    res.setHeader('X-Accel-Buffering', 'no');

    if (!respuesta.body) return res.end();

    const stream = Readable.fromWeb(respuesta.body);
    stream.on('error', (err) => {
      console.error('Error en el stream de tracking:', err);
      if (!res.headersSent) {
        problem(res, 502, 'Servicio no disponible', 'Se interrumpió el stream de tracking.', req.originalUrl);
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (err) {
    if (controller.signal.aborted) return;
    console.error(err);
    problem(res, 502, 'Servicio no disponible', 'No se pudo contactar al microservicio de tracking.', req.originalUrl);
  }
}

// Los iframes y EventSource no permiten agregar Authorization. La SPA instala una
// cookie HttpOnly de cinco minutos (sin exponer el token en la URL) y la renueva
// mientras el mapa está abierto. Cada solicitud vuelve a validar el JWT.
app.post('/mapas/sesion', authenticate, requireRole(...ROLES_APP), (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  res.set('Set-Cookie', `mapa_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/mapas; Max-Age=300${req.secure ? '; Secure' : ''}`);
  res.sendStatus(204);
});
app.delete('/mapas/sesion', (req, res) => {
  res.set('Set-Cookie', `mapa_token=; HttpOnly; SameSite=Lax; Path=/mapas; Max-Age=0${req.secure ? '; Secure' : ''}`);
  res.sendStatus(204);
});

function autenticarMapa(req, res, next) {
  const cookie = (req.headers.cookie ?? '').split(';').map((item) => item.trim()).find((item) => item.startsWith('mapa_token='));
  try {
    if (cookie) req.headers.authorization = `Bearer ${decodeURIComponent(cookie.slice('mapa_token='.length))}`;
  } catch {
    return problem(res, 401, 'No autenticado', 'Cookie del mapa inválida.', req.originalUrl);
  }
  authenticate(req, res, next);
}

async function autorizarEnvio(req, res, next) {
  const id = req.params.envioId ?? req.query.envio;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return problem(res, 400, 'Id inválido', 'Se requiere un id de envío válido.', req.originalUrl);
  }
  try {
    // Envíos es la fuente de verdad: devuelve 404 tanto si no existe como si
    // el cliente no es dueño o el cadete no está asignado.
    const respuesta = await fetch(`${ENVIOS_URL}/envios/${encodeURIComponent(id)}`, {
      headers: { authorization: req.headers.authorization },
    });
    if (respuesta.status === 404) return problem(res, 404, 'Envío no encontrado', 'No existe un envío accesible con ese id.', req.originalUrl);
    if (!respuesta.ok) return problem(res, 502, 'Servicio no disponible', 'No se pudo verificar el acceso al envío.', req.originalUrl);
    req.envio = await respuesta.json();
    next();
  } catch (err) {
    console.error('Error autorizando seguimiento:', err);
    problem(res, 502, 'Servicio no disponible', 'No se pudo verificar el acceso al envío.', req.originalUrl);
  }
}

function exigirEnvioEnCamino(req, res, next) {
  if (req.envio.estado !== 'EN_CAMINO') {
    return problem(res, 409, 'Seguimiento no disponible', 'El envío no está en camino.', req.originalUrl);
  }
  next();
}

const staff = requireRole('operador', 'administrador');
const roles = requireRole(...ROLES_APP);

async function servirMapa(archivo, req, res) {
  try {
    const respuesta = await fetch(`${TRACKING_URL}/${archivo}`);
    if (!respuesta.ok) throw new Error(`Tracking devolvió ${respuesta.status}`);
    const html = (await respuesta.text())
      .replaceAll('/tracking/', '/mapas/tracking/')
      .replaceAll('/cliente.html', '/mapas/cliente.html');
    res.set('Cache-Control', 'no-store').type('html').send(html);
  } catch (err) {
    console.error(err);
    problem(res, 502, 'Servicio no disponible', 'No se pudo cargar el mapa.', req.originalUrl);
  }
}

app.get('/mapas/cliente.html', autenticarMapa, roles, autorizarEnvio, (req, res) => servirMapa('cliente.html', req, res));
app.get('/mapas/', autenticarMapa, staff, (req, res) => servirMapa('index.html', req, res));
app.get('/mapas/envios/:envioId/estado', autenticarMapa, roles, autorizarEnvio, (req, res) => {
  res.set('Cache-Control', 'no-store').json({ estado: req.envio.estado });
});
app.get('/mapas/tracking/envios/:envioId/stream', autenticarMapa, roles, autorizarEnvio, exigirEnvioEnCamino, reenviarTracking);
app.get('/mapas/tracking/cadetes', autenticarMapa, staff, reenviarTracking);
app.get('/mapas/tracking/asignaciones', autenticarMapa, staff, reenviarTracking);
app.get('/mapas/tracking/stream', autenticarMapa, staff, reenviarTracking);
app.get('/mapas/tracking/metrics', autenticarMapa, staff, reenviarTracking);

// El cadete reporta coordenadas autenticado. Nunca se acepta cadeteId del body:
// la identidad que recibe Tracking se obtiene del token validado por el gateway.
app.post('/tracking/ubicaciones', authenticate, requireRole('cadete'), (req, res, next) => {
  const { lat, lng, ts, rumbo } = req.body ?? {};
  req.body = { cadeteId: req.user.username, lat, lng, ts, rumbo };
  next();
}, reenviarTracking);

app.get('/tracking/envios/:envioId/posicion', authenticate, roles, autorizarEnvio, exigirEnvioEnCamino, reenviarTracking);
app.get('/tracking/envios/:envioId/stream', authenticate, roles, autorizarEnvio, exigirEnvioEnCamino, reenviarTracking);
app.get('/tracking/cadetes/:id/posicion', authenticate, roles, (req, res, next) => {
  if (req.user.roles.includes('operador') || req.user.roles.includes('administrador') ||
      (req.user.roles.includes('cadete') && req.params.id === req.user.username)) return next();
  return problem(res, 404, 'Cadete no encontrado', 'No existe un cadete accesible con ese id.', req.originalUrl);
}, reenviarTracking);
app.get('/tracking/cadetes', authenticate, staff, reenviarTracking);
app.get('/tracking/asignaciones', authenticate, staff, reenviarTracking);
app.get('/tracking/stream', authenticate, staff, reenviarTracking);
app.get('/tracking/metrics', authenticate, staff, reenviarTracking);

// ---------- Errores ----------
app.use((req, res) => {
  problem(res, 404, 'Ruta no encontrada', `No existe la ruta ${req.method} ${req.originalUrl}.`, req.originalUrl);
});

app.use((err, req, res, next) => {
  console.error(err);
  problem(res, 500, 'Error interno', 'Ocurrió un error inesperado.', req.originalUrl);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API Gateway escuchando en el puerto ${port} (envios en ${ENVIOS_URL})`));
