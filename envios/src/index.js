import express from 'express';
import pg from 'pg';
import { authenticate, requireRole, problem } from './auth.js';
import { connectBroker, publishEvent } from './broker.js';

const app = express();
app.use(express.json());

// Conexión a Base de Datos PostgreSQL
const pool = new pg.Pool({
  host: process.env.DB_HOST ?? 'envios-db',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'cursos',
  user: process.env.DB_USER ?? 'cursos',
  password: process.env.DB_PASSWORD ?? 'cursos123',
});

const ROLES_APP = ['administrador', 'operador', 'cadete', 'cliente'];
const esStaff = (user) => user.roles.includes('administrador') || user.roles.includes('operador');

// Autorización por recurso: staff ve todo, cliente lo que creó, cadete lo asignado (NFR-6)
function puedeVer(user, envio) {
  return esStaff(user)
    || (user.roles.includes('cliente') && envio.cliente === user.username)
    || (user.roles.includes('cadete') && envio.mensajero === user.username);
}

// ---------- Pública ----------
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'envios', db: 'connected' });
  } catch (err) {
    console.error('Health check DB error:', err.message);
    problem(res, 503, 'Base de datos no disponible', 'Falla de conexión a la base de datos de envíos.', req.originalUrl);
  }
});

// ---------- Todo lo que sigue exige token OIDC válido (Zero Trust) ----------
app.use(authenticate);

// Listar envíos filtrados según permisos del usuario
app.get('/envios', requireRole(...ROLES_APP), async (req, res) => {
  try {
    let query = 'SELECT * FROM envios';
    const params = [];

    if (!esStaff(req.user)) {
      if (req.user.roles.includes('cliente')) {
        params.push(req.user.username);
        query += ' WHERE cliente = $1';
      } else if (req.user.roles.includes('cadete')) {
        params.push(req.user.username);
        query += ' WHERE mensajero = $1';
      }
    }

    query += ' ORDER BY id DESC LIMIT 100';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error al listar envios:', err);
    problem(res, 500, 'Error de base de datos', 'No se pudieron recuperar los envíos.', req.originalUrl);
  }
});

// Obtener detalle de un envío con su historial de estados
app.get('/envios/:id', requireRole(...ROLES_APP), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return problem(res, 400, 'Id inválido', 'El id debe ser un número entero.', req.originalUrl);

  try {
    const { rows } = await pool.query('SELECT * FROM envios WHERE id = $1', [id]);
    const envio = rows[0];

    // Si no existe o no tiene permisos, 404 para no revelar existencia
    if (!envio || !puedeVer(req.user, envio)) {
      return problem(res, 404, 'Envío no encontrado', `No existe un envío con id ${id}.`, req.originalUrl);
    }

    const { rows: historial } = await pool.query(
      'SELECT * FROM historial_estados_envio WHERE envio_id = $1 ORDER BY registrado_en ASC',
      [id]
    );

    res.json({ ...envio, historial });
  } catch (err) {
    console.error(`Error al obtener envio ${id}:`, err);
    problem(res, 500, 'Error de base de datos', 'No se pudo obtener el detalle del envío.', req.originalUrl);
  }
});

// Crear un envío: clientes y staff
app.post('/envios', requireRole('cliente', 'operador', 'administrador'), async (req, res) => {
  const { origen, destino, lat_origen, lon_origen, lat_destino, lon_destino } = req.body ?? {};
  if (typeof origen !== 'string' || origen.trim() === '' || typeof destino !== 'string' || destino.trim() === '') {
    return problem(res, 400, 'Datos inválidos', 'Se requiere "origen" y "destino" (texto).', req.originalUrl);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const numeroSeguimiento = `ENV-${Date.now().toString().slice(-6)}`;

    const insertQuery = `
      INSERT INTO envios (numero_seguimiento, origen, destino, lat_origen, lon_origen, lat_destino, lon_destino, estado, cliente, consultas_mapas_realizadas)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDIENTE', $8, 2)
      RETURNING *;
    `;
    const { rows } = await client.query(insertQuery, [
      numeroSeguimiento,
      origen.trim(),
      destino.trim(),
      lat_origen ?? null,
      lon_origen ?? null,
      lat_destino ?? null,
      lon_destino ?? null,
      req.user.username,
    ]);
    const nuevoEnvio = rows[0];

    await client.query(
      `INSERT INTO historial_estados_envio (envio_id, estado_anterior, estado_nuevo, cambiado_por, motivo)
       VALUES ($1, NULL, 'PENDIENTE', $2, 'Envío registrado en plataforma')`,
      [nuevoEnvio.id, req.user.username]
    );

    await client.query('COMMIT');

    // Notificar al Broker (NFR-2 / EDA)
    publishEvent('envio.creado', nuevoEnvio);

    res.status(201).location(`/envios/${nuevoEnvio.id}`).json(nuevoEnvio);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear envío:', err);
    problem(res, 500, 'Error interno', 'No se pudo registrar el envío.', req.originalUrl);
  } finally {
    client.release();
  }
});

// Asignar un envío a un cadete: solo staff (Operador o Administrador)
// CASO DE USO MÍNIMO OFICIAL
app.patch('/envios/:id/asignar', requireRole('operador', 'administrador'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return problem(res, 400, 'Id inválido', 'El id debe ser un número entero.', req.originalUrl);

  const { mensajero } = req.body ?? {};
  if (typeof mensajero !== 'string' || mensajero.trim() === '') {
    return problem(res, 400, 'Datos inválidos', 'Se requiere "mensajero" (username del cadete).', req.originalUrl);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloqueo pesimista para evitar concurrencia entre operadores
    const { rows } = await client.query('SELECT * FROM envios WHERE id = $1 FOR UPDATE', [id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return problem(res, 404, 'Envío no encontrado', `No existe un envío con id ${id}.`, req.originalUrl);
    }

    const envioActual = rows[0];
    if (envioActual.estado !== 'PENDIENTE') {
      await client.query('ROLLBACK');
      return problem(
        res,
        409,
        'Estado no asignable',
        `El envío ${id} se encuentra en estado "${envioActual.estado}" y no puede ser asignado.`,
        req.originalUrl
      );
    }

    const updateQuery = `
      UPDATE envios
      SET estado = 'ASIGNADO',
          mensajero = $1,
          operador_asignador = $2,
          fecha_asignacion = now(),
          actualizado_en = now(),
          consultas_mapas_realizadas = consultas_mapas_realizadas + 1
      WHERE id = $3
      RETURNING *;
    `;
    const resUpdate = await client.query(updateQuery, [mensajero.trim(), req.user.username, id]);
    const envioAsignado = resUpdate.rows[0];

    await client.query(
      `INSERT INTO historial_estados_envio (envio_id, estado_anterior, estado_nuevo, cambiado_por, motivo)
       VALUES ($1, 'PENDIENTE', 'ASIGNADO', $2, 'Envío asignado por operador')`,
      [id, req.user.username]
    );

    await client.query('COMMIT');

    // Publicación del evento en RabbitMQ para difusión en tiempo real (NFR-1 / NFR-2)
    publishEvent('envio.asignado', {
      envioId: envioAsignado.id,
      numeroSeguimiento: envioAsignado.numero_seguimiento,
      cliente: envioAsignado.cliente,
      mensajero: envioAsignado.mensajero,
      operador: envioAsignado.operador_asignador,
      estadoAnterior: 'PENDIENTE',
      estadoNuevo: 'ASIGNADO',
      fechaAsignacion: envioAsignado.fecha_asignacion,
    });

    res.json(envioAsignado);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Error al asignar envío ${id}:`, err);
    problem(res, 500, 'Error interno', 'No se pudo realizar la asignación del envío.', req.originalUrl);
  } finally {
    client.release();
  }
});

// Actualizar el estado: solo el cadete asignado a ese envío
app.patch('/envios/:id/estado', requireRole('cadete'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return problem(res, 400, 'Id inválido', 'El id debe ser un número entero.', req.originalUrl);

  const { estado, motivo } = req.body ?? {};
  const estadosValidos = ['EN_CAMINO', 'ENTREGADO', 'NO_ENTREGADO'];
  if (!estadosValidos.includes(estado)) {
    return problem(res, 400, 'Datos inválidos', `El estado debe ser uno de: ${estadosValidos.join(', ')}.`, req.originalUrl);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM envios WHERE id = $1 FOR UPDATE', [id]);
    const envio = rows[0];

    // Si no existe o pertenece a otro cadete, responde 404
    if (!envio || envio.mensajero !== req.user.username) {
      await client.query('ROLLBACK');
      return problem(res, 404, 'Envío no encontrado', `No existe un envío con id ${id} asignado a tu usuario.`, req.originalUrl);
    }

    const updateQuery = `
      UPDATE envios
      SET estado = $1,
          fecha_entrega = CASE WHEN $1 IN ('ENTREGADO', 'NO_ENTREGADO') THEN now() ELSE fecha_entrega END,
          actualizado_en = now(),
          consultas_mapas_realizadas = CASE WHEN $1 = 'EN_CAMINO' THEN consultas_mapas_realizadas + 1 ELSE consultas_mapas_realizadas END
      WHERE id = $2
      RETURNING *;
    `;
    const resUpdate = await client.query(updateQuery, [estado, id]);
    const envioActualizado = resUpdate.rows[0];

    await client.query(
      `INSERT INTO historial_estados_envio (envio_id, estado_anterior, estado_nuevo, cambiado_por, motivo)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, envio.estado, estado, req.user.username, motivo || 'Actualización de estado por cadete']
    );

    await client.query('COMMIT');

    publishEvent('envio.estado_actualizado', {
      envioId: envioActualizado.id,
      numeroSeguimiento: envioActualizado.numero_seguimiento,
      cliente: envioActualizado.cliente,
      mensajero: envioActualizado.mensajero,
      estadoAnterior: envio.estado,
      estadoNuevo: estado,
      timestamp: new Date().toISOString(),
    });

    res.json(envioActualizado);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Error al actualizar estado de envío ${id}:`, err);
    problem(res, 500, 'Error interno', 'No se pudo actualizar el estado del envío.', req.originalUrl);
  } finally {
    client.release();
  }
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
app.listen(port, async () => {
  console.log(`[Microservicio Envíos] Escuchando en el puerto ${port}`);
  await connectBroker();
});
