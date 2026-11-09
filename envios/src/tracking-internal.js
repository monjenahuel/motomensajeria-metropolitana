import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { problem } from './auth.js';

const secret = process.env.TRACKING_SYNC_SECRET;
if (!secret) throw new Error('Falta TRACKING_SYNC_SECRET para la sincronización interna con Tracking.');

const huella = (valor) => createHash('sha256').update(valor).digest();

export function crearModuloTrackingInterno(pool) {
  const router = express.Router();

  // Solo Tracking puede consultar la fuente de verdad; este router no pasa por el gateway.
  router.use((req, res, next) => {
    const recibida = req.get('x-tracking-sync-secret') ?? '';
    if (!timingSafeEqual(huella(recibida), huella(secret))) {
      return problem(res, 403, 'Acceso denegado', 'Credencial interna inválida.', req.originalUrl);
    }
    next();
  });

  router.get('/asignaciones', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id AS "envioId", mensajero AS "cadeteId"
         FROM envios
         WHERE estado IN ('ASIGNADO', 'EN_CAMINO') AND mensajero IS NOT NULL`
      );
      res.json(rows);
    } catch (err) {
      console.error('Error consultando asignaciones para Tracking:', err);
      problem(res, 503, 'Base de datos no disponible', 'No se pudieron recuperar las asignaciones.', req.originalUrl);
    }
  });

  return router;
}
