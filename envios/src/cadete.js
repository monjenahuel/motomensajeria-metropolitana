import express from 'express';
import { problem } from './auth.js';

// Los envíos usan UUID v7 (ver envios-db/init.sql).
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const esUuidV7 = (valor) => UUID_V7.test(valor);

const ESTADOS_CADETE = ['EN_CAMINO', 'ENTREGADO', 'NO_ENTREGADO'];

// Datos que ve el cadete de sus envíos asignados.
const CAMPOS_ENVIO = `
  id, origen, destino,
  lat_origen, lon_origen, lat_destino, lon_destino,
  estado, cliente, mensajero,
  fecha_asignacion, fecha_entrega, actualizado_en
`;

/**
 * Módulo Cadete: vista y operación de los envíos asignados al usuario autenticado.
 *
 * El cadete solo puede ver sus propios envíos (mensajero = username) y cambiar
 * el estado de los mismos. Los cambios se persisten en PostgreSQL y se publican
 * como `envio.estado_actualizado` para que Tracking libere la asignación cuando
 * el envío finaliza.
 */
export function crearModuloCadete({ pool, publishEvent }) {
  // GET /cadete/envios → envíos asignados al cadete autenticado.
  async function listarEnvios(req, res) {
    try {
      const { rows } = await pool.query(
        `SELECT ${CAMPOS_ENVIO}
         FROM envios
         WHERE mensajero = $1
         ORDER BY fecha_asignacion DESC NULLS LAST, id DESC
         LIMIT 100`,
        [req.user.username]
      );
      res.json(rows);
    } catch (err) {     
      console.error('Error al listar envíos del cadete:', err);
      problem(res, 500, 'Error de base de datos', 'No se pudieron recuperar tus envíos.', req.originalUrl);
    }
  }

  // GET /cadete/envios/:id → datos básicos de un envío propio.
  async function detalleEnvio(req, res) {
    const id = req.params.id;
    if (!esUuidV7(id)) {
      return problem(res, 400, 'Id inválido', 'El id debe ser un UUID v7.', req.originalUrl);
    }

    try {
      const { rows } = await pool.query(
        `SELECT ${CAMPOS_ENVIO} FROM envios WHERE id = $1 AND mensajero = $2`,
        [id, req.user.username]
      );
      const envio = rows[0];

      // 404 tanto si no existe como si está asignado a otro cadete.
      if (!envio) {
        return problem(res, 404, 'Envío no encontrado', `No tenés asignado un envío con id ${id}.`, req.originalUrl);
      }

      res.json(envio);
    } catch (err) {
      console.error(`Error al obtener el envío ${id} del cadete:`, err);
      problem(res, 500, 'Error de base de datos', 'No se pudo recuperar el envío.', req.originalUrl);
    }
  }

  // PATCH /cadete/envios/:id/estado → el cadete asignado actualiza el estado.
  // También se usa desde PATCH /envios/:id/estado por compatibilidad.
  async function actualizarEstado(req, res) {
    const id = req.params.id;
    if (!esUuidV7(id)) {
      return problem(res, 400, 'Id inválido', 'El id debe ser un UUID v7.', req.originalUrl);
    }

    const { estado, motivo } = req.body ?? {};
    if (!ESTADOS_CADETE.includes(estado)) {
      return problem(
        res,
        400,
        'Datos inválidos',
        `El estado debe ser uno de: ${ESTADOS_CADETE.join(', ')}.`,
        req.originalUrl
      );
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

      if (['ENTREGADO', 'NO_ENTREGADO', 'CANCELADO'].includes(envio.estado)) {
        await client.query('ROLLBACK');
        return problem(
          res,
          409,
          'Envío finalizado',
          `El envío ${id} ya está en estado "${envio.estado}" y no admite más cambios.`,
          req.originalUrl
        );
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
  }

  const router = express.Router();
  router.get('/envios', listarEnvios);
  router.get('/envios/:id', detalleEnvio);
  router.patch('/envios/:id/estado', actualizarEstado);

  return { router, actualizarEstado };
}
