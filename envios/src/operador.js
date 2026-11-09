import express from 'express';
import { problem } from './auth.js';

// Los envíos usan UUID v7 (ver envios-db/init.sql).
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const esUuidV7 = (valor) => UUID_V7.test(valor);

/**
 * Módulo Operador: es el dueño de las asignaciones envío ↔ cadete.
 *
 * Persiste las asignaciones en PostgreSQL y publica los eventos de dominio
 * (`envio.asignado` / `envio.estado_actualizado`). Tracking solo consume esos
  * eventos para mantener su proyección en PostgreSQL propio; no gestiona asignaciones.
 */
export function crearModuloOperador({ pool, publishEvent }) {
  // Asigna un envío PENDIENTE a un cadete.
  // Se usa desde PATCH /envios/:id/asignar y desde POST /operador/asignaciones.
  async function asignarEnvio(req, res) {
    const envioId = req.params.id ?? req.body?.envioId;
    if (!esUuidV7(envioId)) {
      return problem(res, 400, 'Id inválido', 'El id debe ser un UUID v7.', req.originalUrl);
    }

    const { mensajero } = req.body ?? {};
    if (typeof mensajero !== 'string' || mensajero.trim() === '') {
      return problem(res, 400, 'Datos inválidos', 'Se requiere "mensajero" (username del cadete).', req.originalUrl);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Bloqueo pesimista para evitar concurrencia entre operadores
      const { rows } = await client.query('SELECT * FROM envios WHERE id = $1 FOR UPDATE', [envioId]);
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return problem(res, 404, 'Envío no encontrado', `No existe un envío con id ${envioId}.`, req.originalUrl);
      }

      const envioActual = rows[0];
      if (envioActual.estado !== 'PENDIENTE') {
        await client.query('ROLLBACK');
        return problem(
          res,
          409,
          'Estado no asignable',
          `El envío ${envioId} se encuentra en estado "${envioActual.estado}" y no puede ser asignado.`,
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
      const resUpdate = await client.query(updateQuery, [mensajero.trim(), req.user.username, envioId]);
      const envioAsignado = resUpdate.rows[0];

      await client.query(
        `INSERT INTO historial_estados_envio (envio_id, estado_anterior, estado_nuevo, cambiado_por, motivo)
         VALUES ($1, 'PENDIENTE', 'ASIGNADO', $2, 'Envío asignado por operador')`,
        [envioId, req.user.username]
      );

      await client.query('COMMIT');

      // Evento de dominio: Tracking y cualquier otro consumidor se enteran por acá.
      publishEvent('envio.asignado', {
        envioId: envioAsignado.id,
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
      console.error(`Error al asignar envío ${envioId}:`, err);
      problem(res, 500, 'Error interno', 'No se pudo realizar la asignación del envío.', req.originalUrl);
    } finally {
      client.release();
    }
  }

  // Libera una asignación todavía no iniciada y deja el envío nuevamente PENDIENTE.
  async function liberarAsignacion(req, res) {
    const envioId = req.params.envioId;
    if (!esUuidV7(envioId)) {
      return problem(res, 400, 'Id inválido', 'El id debe ser un UUID v7.', req.originalUrl);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query('SELECT * FROM envios WHERE id = $1 FOR UPDATE', [envioId]);
      const envio = rows[0];

      if (!envio || !envio.mensajero) {
        await client.query('ROLLBACK');
        return problem(res, 404, 'Asignación no encontrada', `El envío ${envioId} no tiene un cadete asignado.`, req.originalUrl);
      }

      if (envio.estado !== 'ASIGNADO') {
        await client.query('ROLLBACK');
        return problem(
          res,
          409,
          'Estado no liberable',
          `El envío ${envioId} está en estado "${envio.estado}". Solo se puede liberar una asignación en estado ASIGNADO.`,
          req.originalUrl
        );
      }

      const resUpdate = await client.query(
        `UPDATE envios
         SET estado = 'PENDIENTE',
             mensajero = NULL,
             operador_asignador = NULL,
             fecha_asignacion = NULL,
             actualizado_en = now()
         WHERE id = $1
         RETURNING *;`,
        [envioId]
      );
      const envioLiberado = resUpdate.rows[0];

      await client.query(
        `INSERT INTO historial_estados_envio (envio_id, estado_anterior, estado_nuevo, cambiado_por, motivo)
         VALUES ($1, 'ASIGNADO', 'PENDIENTE', $2, 'Asignación liberada por operador')`,
        [envioId, req.user.username]
      );

      await client.query('COMMIT');

      publishEvent('envio.estado_actualizado', {
        envioId: envioLiberado.id,
        cliente: envioLiberado.cliente,
        mensajero: null,
        estadoAnterior: 'ASIGNADO',
        estadoNuevo: 'PENDIENTE',
        timestamp: new Date().toISOString(),
      });

      res.json(envioLiberado);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Error al liberar la asignación del envío ${envioId}:`, err);
      problem(res, 500, 'Error interno', 'No se pudo liberar la asignación del envío.', req.originalUrl);
    } finally {
      client.release();
    }
  }

  // Vista de envíos con cadete asignado para el operador (fuente: PostgreSQL).
  async function listarAsignaciones(req, res) {
    try {
      const { rows } = await pool.query(
        `SELECT *
         FROM envios
         WHERE mensajero IS NOT NULL
         ORDER BY fecha_asignacion DESC NULLS LAST, id DESC
         LIMIT 200`
      );
      res.json(rows);
    } catch (err) {
      console.error('Error al listar asignaciones:', err);
      problem(res, 500, 'Error de base de datos', 'No se pudieron recuperar las asignaciones.', req.originalUrl);
    }
  }

  const router = express.Router();
  router.get('/asignaciones', listarAsignaciones);
  router.post('/asignaciones', asignarEnvio);
  router.delete('/asignaciones/:envioId', liberarAsignacion);

  return { router, asignarEnvio };
}
