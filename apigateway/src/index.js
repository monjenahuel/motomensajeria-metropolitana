import express from 'express';
import { authenticate, requireRole, problem } from './auth.js';

const app = express();
app.use(express.json());

// URL interna del microservicio de envíos (nombre del servicio en docker-compose)
const ENVIOS_URL = process.env.ENVIOS_URL ?? 'http://envios:3000';
const KEYCLOAK_INTERNAL_URL = process.env.KEYCLOAK_INTERNAL_URL ?? 'http://keycloak:8080';
const KC_REALM = process.env.KC_REALM ?? 'motomensajeria';

// Roles de la aplicación (los mismos que en el realm de Keycloak)
const ROLES_APP = ['administrador', 'operador', 'cadete', 'cliente'];

// CORS: el frontend (Angular, localhost:4200) llama al gateway desde otro origen.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
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