import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

async function servidor(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('mapas y seguimiento requieren identidad y autorización por envío', async (t) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test', use: 'sig', alg: 'RS256' };
  const jwt = (username, role) => new SignJWT({ preferred_username: username, realm_access: { roles: [role] } })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer('http://issuer.test').setAudience('motomensajeria-api')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const id = '019927d4-1234-7123-8123-0123456789ab';
  let cadeteAsignado = true;
  let estado = 'EN_CAMINO';
  const jwks = await servidor((req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] }));
  });
  const envios = await servidor((req, res) => {
    const usuario = req.headers.authorization === `Bearer ${t.tokenCliente}` ? 'cliente' :
      req.headers.authorization === `Bearer ${t.tokenCadete}` ? 'cadete' :
      req.headers.authorization === `Bearer ${t.tokenStaff}` ? 'staff' : 'otro';
    res.statusCode = req.url === `/envios/${id}` &&
      (usuario === 'cliente' || usuario === 'staff' || (usuario === 'cadete' && cadeteAsignado)) ? 200 : 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ estado }));
  });
  const tracking = await servidor((req, res) => {
    res.setHeader('Content-Type', req.url.endsWith('/stream') ? 'text/event-stream' : 'text/html');
    res.end(req.url === '/cliente.html' ? '<script>new EventSource(`/tracking/envios/x/stream`)</script>' : 'posiciones');
  });
  t.after(() => Promise.all([jwks, envios, tracking].map(({ server }) => new Promise((resolve) => server.close(resolve)))));
  t.tokenCliente = await jwt('dueño', 'cliente');
  t.tokenCadete = await jwt('asignado', 'cadete');
  t.tokenStaff = await jwt('operador', 'operador');
  const puerto = await servidor((_req, res) => res.end()).then(async ({ server }) => {
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
  });
  const gateway = spawn(process.execPath, ['src/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(puerto), ENVIOS_URL: envios.url, TRACKING_URL: tracking.url,
      KEYCLOAK_ISSUER: 'http://issuer.test', KEYCLOAK_JWKS_URI: jwks.url },
    stdio: 'ignore',
  });
  t.after(() => gateway.kill());
  const base = `http://127.0.0.1:${puerto}`;
  let listo = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) { listo = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(listo, 'el Gateway debe iniciar');
  const pedir = (ruta, token, cookie) => fetch(`${base}${ruta}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  assert.equal((await pedir(`/tracking/envios/${id}/posicion`)).status, 401);
  assert.equal((await pedir('/tracking/stream', t.tokenCliente)).status, 403);
  assert.equal((await pedir('/tracking/cadetes', t.tokenCadete)).status, 403);
  assert.equal((await pedir(`/tracking/envios/${id}/posicion`, await jwt('ajeno', 'cliente'))).status, 404);
  assert.equal((await pedir(`/tracking/envios/${id}/posicion`, t.tokenCliente)).status, 200);
  assert.equal((await pedir(`/tracking/envios/${id}/posicion`, t.tokenCadete)).status, 200);
  estado = 'ASIGNADO';
  assert.equal((await pedir(`/tracking/envios/${id}/posicion`, t.tokenCliente)).status, 409);
  assert.equal((await pedir(`/tracking/envios/${id}/stream`, t.tokenCliente)).status, 409);
  estado = 'EN_CAMINO';
  cadeteAsignado = false;
  assert.equal((await pedir(`/tracking/envios/${id}/posicion`, t.tokenCadete)).status, 404);
  assert.equal((await pedir('/tracking/stream', t.tokenStaff)).status, 200);
  assert.equal((await pedir('/mapas/cliente.html?envio=' + id)).status, 401);
  assert.equal((await pedir('/mapas/cliente.html?envio=' + id, null, 'mapa_token=%INVALIDO')).status, 401);
  const sesion = await fetch(`${base}/mapas/sesion`, { method: 'POST', headers: { Authorization: `Bearer ${t.tokenCliente}` } });
  assert.equal(sesion.status, 204);
  const cookie = sesion.headers.get('set-cookie').split(';')[0];
  const mapa = await pedir(`/mapas/cliente.html?envio=${id}`, null, cookie);
  assert.equal(mapa.status, 200);
  assert.match(await mapa.text(), /\/mapas\/tracking\/envios/);
  assert.equal((await pedir(`/mapas/tracking/envios/${id}/stream`, null, cookie)).status, 200);
  assert.equal((await pedir(`/mapas/tracking/envios/${id}/stream?origen=prueba`, null, cookie)).status, 200);
  assert.deepEqual(await (await pedir(`/mapas/envios/${id}/estado`, null, cookie)).json(), { estado: 'EN_CAMINO' });
  estado = 'ENTREGADO';
  assert.deepEqual(await (await pedir(`/mapas/envios/${id}/estado`, null, cookie)).json(), { estado: 'ENTREGADO' });
  assert.equal((await pedir(`/mapas/tracking/envios/${id}/stream`, null, cookie)).status, 409);
  estado = 'NO_ENTREGADO';
  assert.deepEqual(await (await pedir(`/mapas/envios/${id}/estado`, null, cookie)).json(), { estado: 'NO_ENTREGADO' });
  assert.equal((await pedir(`/mapas/envios/${id}/estado`, null, 'mapa_token=%INVALIDO')).status, 401);
  assert.equal((await pedir(`/mapas/envios/${id}/estado`, null, `mapa_token=${await jwt('ajeno', 'cliente')}`)).status, 404);
  assert.equal((await pedir('/mapas/tracking/stream', null, cookie)).status, 403);
  assert.equal((await pedir('/mapas/', null, cookie)).status, 403);
  const staffSesion = await fetch(`${base}/mapas/sesion`, { method: 'POST', headers: { Authorization: `Bearer ${t.tokenStaff}` } });
  const staffCookie = staffSesion.headers.get('set-cookie').split(';')[0];
  assert.equal((await pedir('/mapas/', null, staffCookie)).status, 200);
  const cerrar = await fetch(`${base}/mapas/sesion`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(cerrar.status, 204);
  assert.match(cerrar.headers.get('set-cookie'), /Max-Age=0/);
});
