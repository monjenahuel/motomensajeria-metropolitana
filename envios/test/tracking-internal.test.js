import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.KEYCLOAK_ISSUER = 'http://localhost:8081/realms/motomensajeria';
process.env.KEYCLOAK_JWKS_URI = 'http://localhost:8081/realms/motomensajeria/protocol/openid-connect/certs';
process.env.TRACKING_SYNC_SECRET = 'secreto-de-prueba';

const { crearModuloTrackingInterno } = await import('../src/tracking-internal.js');
const id = '01a1a901-5800-7000-8000-000000000001';

test('solo Tracking consulta asignaciones activas de PostgreSQL', async () => {
  let estado = 'ASIGNADO';
  const pool = {
    async query(_sql, params) {
      const rows = estado === 'ASIGNADO' || estado === 'EN_CAMINO'
        ? [{ envioId: id, cadeteId: 'cadete.demo' }]
        : [];
      return { rows: params && params[0] !== id ? [] : rows };
    },
  };
  const app = express();
  app.use('/internal/tracking', crearModuloTrackingInterno(pool));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/internal/tracking/asignaciones`;
    assert.equal((await fetch(base)).status, 403);
    const headers = { 'x-tracking-sync-secret': 'secreto-de-prueba' };
    assert.deepEqual(await (await fetch(base, { headers })).json(), [{ envioId: id, cadeteId: 'cadete.demo' }]);
    estado = 'ENTREGADO';
    assert.deepEqual(await (await fetch(base, { headers })).json(), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
