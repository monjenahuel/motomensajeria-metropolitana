import express from 'express';
import { Readable } from 'node:stream';
import { authenticate, requireRole, problem } from './auth.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// URL interna del microservicio de envíos (nombre del servicio en docker-compose)
const ENVIOS_URL = process.env.ENVIOS_URL ?? 'http://envios:3000';
// URL interna del microservicio de notificaciones
const NOTIFICACIONES_URL = process.env.NOTIFICACIONES_URL ?? 'http://notificaciones:3000';
// URL interna del microservicio de tracking
const TRACKING_URL = process.env.TRACKING_URL ?? 'http://tracking:3000';
// Endpoint de token de Keycloak (red interna de Docker)
const KEYCLOAK_TOKEN_URL = process.env.KEYCLOAK_TOKEN_URL
  ?? 'http://keycloak:8080/realms/motomensajeria/protocol/openid-connect/token';

// Roles de la aplicación (los mismos que en el realm de Keycloak)
const ROLES_APP = ['administrador', 'operador', 'cadete', 'cliente'];

// CORS: el frontend (Angular, localhost:4200) llama al gateway desde otro origen.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Token para Swagger UI ----------
// Swagger UI pide el token desde el navegador. Keycloak solo habilita CORS para
// los orígenes configurados en el cliente, así que el gateway expone este proxy
// con su propia política CORS. Solo reenvía el password grant tal cual.
app.post('/auth/token', async (req, res) => {
  try {
    const body = new URLSearchParams(req.body ?? {}).toString();
    const respuesta = await fetch(KEYCLOAK_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    res.status(respuesta.status);
    const tipo = respuesta.headers.get('content-type');
    if (tipo) res.setHeader('Content-Type', tipo);
    res.send(Buffer.from(await respuesta.arrayBuffer()));
  } catch (err) {
    console.error(err);
    problem(res, 502, 'Servicio de identidad no disponible', 'No se pudo obtener el token desde Keycloak.', req.originalUrl);
  }
});

// ---------- Rutas públicas ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

app.get('/', (req, res) => {
  res.json({
    service: 'api-gateway',
    mensaje: 'API Gateway funcionando. Las rutas /envios, /operador y /cadete requieren un token Bearer.',
    rutas: ['/health', '/auth/token', '/envios', '/operador', '/cadete', '/notificaciones', '/tracking'],
  });
});

// ---------- Reenvío a envíos ----------
// Reenvía método, body y token al microservicio. La autorización fina por rol (y por dueño del envío)
// la vuelve a aplicar el propio microservicio.
async function reenviarA(baseUrl, req, res) {
  try {
    const init = { method: req.method, headers: { authorization: req.headers.authorization } };
    const tieneBody = !['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length > 0;
    if (tieneBody) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }
    const respuesta = await fetch(`${baseUrl}${req.originalUrl}`, init);
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

const reenviar = (req, res) => reenviarA(ENVIOS_URL, req, res);
const reenviarNotificaciones = (req, res) => reenviarA(NOTIFICACIONES_URL, req, res);

// El gateway rechaza lo obvio: sin token válido (401) o sin ningún rol de la aplicación (403).
app.use('/envios', authenticate, requireRole(...ROLES_APP), reenviar);

// Avisos al cliente (microservicio de notificaciones): el cliente ve los suyos, el staff todos.
app.use('/notificaciones', authenticate, requireRole('cliente', 'operador', 'administrador'), reenviarNotificaciones);

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

    const respuesta = await fetch(`${TRACKING_URL}${req.originalUrl}`, init);
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

// Tracking no valida JWT en la demo: el gateway solo actúa como proxy.
app.use('/tracking', reenviarTracking);

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