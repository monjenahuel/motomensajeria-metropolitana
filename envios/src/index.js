import express from 'express';
import { authenticate, requireRole, problem } from './auth.js';

const app = express();
app.use(express.json());

// Datos de ejemplo en memoria (mock). Más adelante se reemplazan por la base de datos del servicio.
const envios = [
  { id: 1, origen: 'Av. Corrientes 1000, CABA', destino: 'Av. Cabildo 2000, CABA', estado: 'PENDIENTE', cliente: 'cliente.demo', mensajero: null },
  { id: 2, origen: 'Av. Rivadavia 5000, CABA', destino: 'Calle Mitre 300, Avellaneda', estado: 'EN_CAMINO', cliente: 'cliente.demo', mensajero: 'cadete.demo' },
  { id: 3, origen: 'Av. Santa Fe 2500, CABA', destino: 'Av. Maipú 1500, Vicente López', estado: 'ENTREGADO', cliente: 'cliente.demo', mensajero: 'cadete.demo' },
];
let siguienteId = envios.length + 1;

const ROLES_APP = ['administrador', 'operador', 'cadete', 'cliente'];
const esStaff = (user) => user.roles.includes('administrador') || user.roles.includes('operador');

// Autorización por recurso: el staff ve todo, el cliente solo lo que creó y el cadete solo lo que tiene asignado.
function puedeVer(user, envio) {
  return esStaff(user)
    || (user.roles.includes('cliente') && envio.cliente === user.username)
    || (user.roles.includes('cadete') && envio.mensajero === user.username);
}

// ---------- Pública ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'envios' });
});

// ---------- Todo lo que sigue exige token válido (el servicio no confía ciegamente en el gateway) ----------
app.use(authenticate);

app.get('/envios', requireRole(...ROLES_APP), (req, res) => {
  res.json(envios.filter((e) => puedeVer(req.user, e)));
});

app.get('/envios/:id', requireRole(...ROLES_APP), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return problem(res, 400, 'Id inválido', 'El id debe ser un número entero.', req.originalUrl);
  const envio = envios.find((e) => e.id === id);
  // Si existe pero no es visible para este usuario, responde 404 para no revelar que existe.
  if (!envio || !puedeVer(req.user, envio)) {
    return problem(res, 404, 'Envío no encontrado', `No existe un envío con id ${id}.`, req.originalUrl);
  }
  res.json(envio);
});

// Crear un envío: clientes y staff
app.post('/envios', requireRole('cliente', 'operador', 'administrador'), (req, res) => {
  const { origen, destino } = req.body ?? {};
  if (typeof origen !== 'string' || origen.trim() === '' || typeof destino !== 'string' || destino.trim() === '') {
    return problem(res, 400, 'Datos inválidos', 'Se requiere "origen" y "destino" (texto).', req.originalUrl);
  }
  const envio = {
    id: siguienteId++, origen: origen.trim(), destino: destino.trim(),
    estado: 'PENDIENTE', cliente: req.user.username, mensajero: null,
  };
  envios.push(envio);
  res.status(201).location(`/envios/${envio.id}`).json(envio);
});

// Asignar un envío a un cadete: solo staff
app.patch('/envios/:id/asignar', requireRole('operador', 'administrador'), (req, res) => {
  const id = Number(req.params.id);
  const envio = envios.find((e) => e.id === id);
  if (!envio) return problem(res, 404, 'Envío no encontrado', `No existe un envío con id ${id}.`, req.originalUrl);
  const { mensajero } = req.body ?? {};
  if (typeof mensajero !== 'string' || mensajero.trim() === '') {
    return problem(res, 400, 'Datos inválidos', 'Se requiere "mensajero" (username del cadete).', req.originalUrl);
  }
  envio.mensajero = mensajero.trim();
  envio.estado = 'ASIGNADO';
  res.json(envio);
});

// Actualizar el estado: solo el cadete asignado a ese envío
app.patch('/envios/:id/estado', requireRole('cadete'), (req, res) => {
  const id = Number(req.params.id);
  const envio = envios.find((e) => e.id === id);
  if (!envio || envio.mensajero !== req.user.username) {
    return problem(res, 404, 'Envío no encontrado', `No existe un envío con id ${id}.`, req.originalUrl);
  }
  const { estado } = req.body ?? {};
  if (!['EN_CAMINO', 'ENTREGADO'].includes(estado)) {
    return problem(res, 400, 'Datos inválidos', 'El estado debe ser "EN_CAMINO" o "ENTREGADO".', req.originalUrl);
  }
  envio.estado = estado;
  res.json(envio);
});

// ---------- Errores ----------
app.use((req, res) => {
  problem(res, 404, 'Ruta no encontrada', `No existe la ruta ${req.method} ${req.originalUrl}.`, req.originalUrl);
});

app.use((err, req, res, next) => {
  console.error(err);
  problem(res, 500, 'Error interno', 'Ocurrió un error inesperado.', req.originalUrl);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Microservicio de envíos escuchando en el puerto ${port}`));