// Prueba de punta a punta de Mapas y Notificaciones SIN RabbitMQ ni Keycloak, con los eventos tal como los publica
// hoy el servicio de Envíos del repo (UUID, "cliente", "mensajero", estados en MAYÚSCULA, NUMERIC como texto).
// Un bus en memoria reemplaza al broker y se inyecta una autenticación falsa.
//
//   cd notificaciones && npm install && cd ..
//   node test/flujo.mjs
import assert from 'node:assert/strict';

process.env.KEYCLOAK_ISSUER = 'http://test/realms/x';
process.env.KEYCLOAK_JWKS_URI = 'http://127.0.0.1:1/jwks'; // no se usa: authenticate se reemplaza en la prueba

const { crearMock } = await import('../mock-mapas/src/server.js');
const { crearClienteMapas } = await import('../mapas/src/cliente-mapas.js');
const { crearHandlers } = await import('../mapas/src/handlers.js');
const { crearNotificaciones } = await import('../notificaciones/src/handlers.js');
const { crearApp } = await import('../notificaciones/src/app.js');
const { requireRole, problem } = await import('../notificaciones/src/auth.js');

const callado = { info() {}, warn() {}, error() {} };
const escuchar = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)));
let pasos = 0;
const paso = (t) => console.log(`  ✔ ${++pasos}. ${t}`);

// ---- Bus en memoria (hace de RabbitMQ) ----
function crearBus() {
  const subs = []; const publicados = []; let n = 0;
  const entregar = async (env) => { for (const s of subs) if (s.tipos.has(env.tipo)) await s.handler(env); };
  return {
    publicados,
    suscribir(tipos, handler) { subs.push({ tipos: new Set(tipos), handler }); },
    async publicar(tipo, data) {
      const env = { eventId: `ev-${++n}`, tipo, data };
      publicados.push(env); await entregar(env); return env;
    },
    entregar, // reentrega un evento ya publicado (simula una redelivery del broker)
  };
}

// ---- Armado ----
const mock = crearMock({ latenciaMs: 0 });
const base = await escuchar(mock);
const stats = async () => (await fetch(`${base}/stats`)).json();
const falla = (activo) => fetch(`${base}/admin/falla`, { method: 'POST', body: JSON.stringify({ activo }) });

const mapas = crearClienteMapas({ baseUrl: base });
const bus = crearBus();
const armarMapas = () => crearHandlers({ mapas, publicar: bus.publicar, log: callado, reintentos: 2, esperaMs: 1 });
let handlersMapas = armarMapas();
const notif = crearNotificaciones({ log: callado });
bus.suscribir(['envio.creado', 'envio.asignado', 'envio.estado_actualizado'], (env) => handlersMapas[env.tipo]?.(env));
bus.suscribir(['envio.creado', 'envio.asignado', 'envio.estado_actualizado', 'envio.eta_estimado', 'envio.geocodificacion_fallida'], (env) => notif.procesar(env));

const tipos = (t) => bus.publicados.filter((e) => e.tipo === t);
const O = 'Av. Corrientes 1000, CABA';
const D = 'Av. Cabildo 2000, CABA';
const ID1 = '01a1a901-5800-7000-8000-000000000001';

// Formas reales de los eventos de Envíos
const creado = (id, origen, destino, extra = {}) => ({
  id, origen, destino, lat_origen: null, lon_origen: null, lat_destino: null, lon_destino: null,
  estado: 'PENDIENTE', cliente: 'cliente.demo', mensajero: null, consultas_mapas_realizadas: 2, ...extra,
});
const asignado = (envioId, extra = {}) => ({
  envioId, cliente: 'cliente.demo', mensajero: 'cadete.demo', operador: 'operador.demo',
  estadoAnterior: 'PENDIENTE', estadoNuevo: 'ASIGNADO', fechaAsignacion: new Date().toISOString(), ...extra,
});
const estado = (envioId, anterior, nuevo, extra = {}) => ({
  envioId, cliente: 'cliente.demo', mensajero: 'cadete.demo', estadoAnterior: anterior, estadoNuevo: nuevo,
  timestamp: new Date().toISOString(), ...extra,
});

console.log('\nMock de mapas');
{
  const r = await (await fetch(`${base}/search?q=${encodeURIComponent(O)}&format=json&limit=1`)).json();
  assert.equal(typeof r[0].lat, 'string'); // igual que Nominatim: lat/lon como texto
  assert.deepEqual(await (await fetch(`${base}/search?q=Calle%20Inexistente%201`)).json(), []);
  const ruta = await (await fetch(`${base}/route/v1/driving/-58.3790,-34.6039;-58.4546,-34.5617`)).json();
  assert.equal(ruta.code, 'Ok'); assert.ok(ruta.routes[0].duration > 0);
  await fetch(`${base}/stats/reset`, { method: 'POST' });
  assert.equal((await stats()).consultas.total, 0);
  paso('responde en formato Nominatim/OSRM, devuelve [] para direcciones inexistentes y el contador se reinicia');
}

console.log('\nFlujo feliz con los eventos reales de Envíos');
await bus.publicar('envio.creado', creado(ID1, O, D));
const geo = tipos('envio.geocodificado').at(-1).data;
assert.ok(Math.abs(geo.origen.lat - -34.6039) < 1e-3 && geo.destino.lon);
assert.equal(geo.cliente, 'cliente.demo');
assert.deepEqual((await stats()).consultas, { total: 2, geocode: 2, route: 0, fallidas: 0 });
paso('envio.creado -> Mapas ubica origen y destino y publica envio.geocodificado (2 consultas)');

await bus.publicar('envio.asignado', asignado(ID1));
const eta1 = tipos('envio.eta_estimado').at(-1).data;
assert.equal(eta1.origenCalculo, 'mapas');
assert.ok(eta1.etaMinutos > 10 && eta1.etaMinutos < 120, `ETA fuera de rango: ${eta1.etaMinutos}`);
paso(`envio.asignado -> ETA de ${eta1.etaMinutos} min (ruta + 10 min de retiro)`);

await bus.publicar('envio.estado_actualizado', estado(ID1, 'ASIGNADO', 'EN_CAMINO'));
const etaEnCamino = tipos('envio.eta_estimado').at(-1).data.etaMinutos;
assert.ok(etaEnCamino < eta1.etaMinutos); // ya no suma el tiempo de retiro
const total = (await stats()).consultas.total;
assert.equal(total, 3); assert.ok(total <= 5);
paso(`EN_CAMINO recalcula el ETA (${etaEnCamino} min) sin consultas nuevas: ${total} por envío (NFR-3: ≤ 5)`);

const antes = tipos('envio.eta_estimado').length;
await bus.publicar('envio.estado_actualizado', estado(ID1, 'EN_CAMINO', 'ENTREGADO'));
assert.equal(tipos('envio.eta_estimado').length, antes);
paso('ENTREGADO no genera ETA');

const avisos = notif.listar({ cliente: 'cliente.demo', envioId: ID1 });
// El orden entre avisos de colas distintas (asignado vs. ETA) no está garantizado: no se asume.
assert.equal(avisos.length, 6); // creado, asignado, ETA, en camino, ETA, entregado
assert.equal(avisos.filter((a) => /Recibimos tu pedido/.test(a.mensaje)).length, 1);
assert.equal(avisos.filter((a) => /llegaría en unos/.test(a.mensaje)).length, 2);
assert.match(avisos.at(-1).mensaje, /entregado/);
assert.match(avisos[0].mensaje, /#000001/); // el UUID se acorta
paso('Notificaciones generó 6 avisos (pedido recibido, asignado, 2 ETA, en camino, entregado)');

console.log('\nEnvío que ya trae coordenadas (Postgres devuelve NUMERIC como texto)');
{
  const ID5 = '01a1a901-5800-7000-8000-000000000005';
  const s0 = await stats();
  const nPub = tipos('envio.geocodificado').length;
  await bus.publicar('envio.creado', creado(ID5, O, D, { lat_origen: '-34.6037000', lon_origen: '-58.3816000', lat_destino: '-34.5614000', lon_destino: '-58.4563000' }));
  assert.deepEqual(await stats(), s0);
  assert.equal(tipos('envio.geocodificado').length, nPub);
  await bus.publicar('envio.asignado', asignado(ID5));
  assert.equal((await stats()).consultas.route, s0.consultas.route + 1);
  assert.equal(tipos('envio.eta_estimado').at(-1).data.envioId, ID5);
  paso('no se consulta para ubicarlo y el ETA sale igual (1 sola consulta de ruta)');
}

console.log('\nNFR-3: las ubicaciones no tocan el servicio de mapas');
{
  const antesStats = await stats();
  for (let i = 0; i < 100; i++) await bus.publicar('cadete.ubicacion_reportada', { cadeteId: 'cadete.demo', lat: -34.6, lon: -58.4 });
  assert.deepEqual(await stats(), antesStats);
  paso('100 reportes de ubicación: el contador del mock no se movió');
}

console.log('\nNFR-7: eventos repetidos');
{
  const envAsignado = bus.publicados.find((e) => e.tipo === 'envio.asignado');
  const nPub = bus.publicados.length; const nAvisos = notif.listar().length; const s = await stats();
  await bus.entregar(envAsignado); await bus.entregar(envAsignado);
  assert.equal(bus.publicados.length, nPub);
  assert.equal(notif.listar().length, nAvisos);
  assert.deepEqual(await stats(), s);
  paso('un evento reentregado no duplica eventos, avisos ni consultas');
}

console.log('\nOperador libera una asignación');
{
  await bus.publicar('envio.estado_actualizado', estado('01a1a901-5800-7000-8000-000000000006', 'ASIGNADO', 'PENDIENTE', { mensajero: null }));
  assert.match(notif.listar().at(-1).mensaje, /volvió a estar pendiente/);
  paso('PENDIENTE (liberada) se avisa al cliente y no genera ETA');
}

console.log('\nDirección inexistente');
await bus.publicar('envio.creado', creado('01a1a901-5800-7000-8000-000000000002', O, 'Calle Inexistente 123, CABA'));
{
  const f = tipos('envio.geocodificacion_fallida').at(-1).data;
  assert.equal(f.motivo, 'direccion_no_encontrada'); assert.match(f.direccion, /Inexistente/);
  assert.ok(notif.listar({ cliente: 'cliente.demo', envioId: '01a1a901-5800-7000-8000-000000000002' }).some((n) => /No pudimos ubicar/.test(n.mensaje)));
  paso('publica envio.geocodificacion_fallida y se le avisa al cliente');
}

console.log('\nNFR-5: servicio de mapas caído');
const ID4 = '01a1a901-5800-7000-8000-000000000004';
await bus.publicar('envio.creado', creado(ID4, O, 'Av. Santa Fe 2500, CABA')); // con el mock arriba
await falla(true);
await bus.publicar('envio.creado', creado('01a1a901-5800-7000-8000-000000000003', 'Av. Rivadavia 5000, CABA', 'Calle Mitre 300, Avellaneda'));
assert.equal(tipos('envio.geocodificacion_fallida').at(-1).data.motivo, 'servicio_de_mapas_no_disponible');
assert.ok((await stats()).consultas.fallidas > 0);
paso('crear un envío con mapas caído no rompe nada: se informa envio.geocodificacion_fallida');

await bus.publicar('envio.asignado', asignado(ID4));
const respaldo = tipos('envio.eta_estimado').at(-1).data;
assert.equal(respaldo.origenCalculo, 'respaldo'); assert.ok(respaldo.etaMinutos > 10);
assert.ok(notif.listar({ envioId: ID4 }).some((n) => /aproximada/.test(n.mensaje)));
paso(`con mapas caído el ETA sale igual (${respaldo.etaMinutos} min, estimación de respaldo) y el aviso lo aclara`);
await falla(false);

console.log('\nMapas se reinicia (pierde su memoria)');
{
  handlersMapas = armarMapas(); // instancia nueva: no recuerda ningún envío
  const n0 = tipos('envio.eta_estimado').length;
  await bus.publicar('envio.asignado', asignado(ID1)); // el evento real no trae direcciones
  assert.equal(tipos('envio.eta_estimado').length, n0);
  paso('sin direcciones en el evento, omite el ETA con un aviso en el log (no se cae)');

  await bus.publicar('envio.asignado', asignado(ID1, { origen: O, destino: D })); // si Envíos las incluyera (pedido opcional)
  const e = tipos('envio.eta_estimado').at(-1).data;
  assert.equal(tipos('envio.eta_estimado').length, n0 + 1);
  assert.equal(e.envioId, ID1);
  paso('si Envíos incluye origen y destino en el evento, recupera el ETA aunque se haya reiniciado');
}

console.log('\nAPI HTTP de Notificaciones (autenticación simulada)');
{
  const authenticate = (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) return problem(res, 401, 'No autenticado', 'sin token', req.originalUrl);
    req.user = JSON.parse(h); next();
  };
  const app = crearApp({ notificaciones: notif, authenticate, requireRole, problem });
  const srv = await new Promise((ok) => { const x = app.listen(0, '127.0.0.1', () => ok(x)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const quien = (username, roles) => ({ 'x-test-user': JSON.stringify({ username, roles }) });
  const get = (p, h) => fetch(`${url}${p}`, { headers: h });

  const propios = await (await get('/notificaciones', quien('cliente.demo', ['cliente']))).json();
  assert.ok(propios.length > 0 && propios.every((n) => n.cliente === 'cliente.demo'));
  assert.deepEqual(await (await get('/notificaciones', quien('otro.cliente', ['cliente']))).json(), []);
  paso('el cliente ve solo sus avisos; otro cliente no ve ninguno');

  const cadete = await get('/notificaciones', quien('cadete.demo', ['cadete']));
  assert.equal(cadete.status, 403); assert.match(cadete.headers.get('content-type'), /problem\+json/);
  assert.equal((await get('/notificaciones')).status, 401);
  paso('el cadete recibe 403 y sin token 401, ambos como Problem Details');

  const staff = await (await get('/notificaciones', quien('operador.demo', ['operador']))).json();
  assert.equal(staff.length, notif.listar().length);
  paso('el operador ve todos los avisos');

  const ultimo = propios.at(-1).id;
  assert.deepEqual(await (await get(`/notificaciones?desde=${ultimo}`, quien('cliente.demo', ['cliente']))).json(), []);
  assert.equal((await get('/notificaciones?desde=abc', quien('cliente.demo', ['cliente']))).status, 400);
  const soloID1 = await (await get(`/notificaciones?envioId=${ID1}`, quien('cliente.demo', ['cliente']))).json();
  assert.ok(soloID1.length >= 6 && soloID1.every((n) => n.envioId === ID1));
  paso('filtros ?desde (polling) y ?envioId; parámetro inválido -> 400');
  srv.close();
}

console.log(`\nTodo OK (${pasos} verificaciones)`);
mock.close();
process.exit(0);
