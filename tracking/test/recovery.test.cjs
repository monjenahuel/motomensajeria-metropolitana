require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TRACKING_SYNC_SECRET = 'secreto-de-prueba';
process.env.RABBITMQ_URL = 'amqp://localhost';
process.env.RABBITMQ_EXCHANGE = 'test.events';
process.env.RABBITMQ_QUEUE = 'test.tracking';
process.env.RABBITMQ_RECONNECT_MS = '1';
process.env.KEYCLOAK_ISSUER = 'http://issuer.test';
process.env.KEYCLOAK_JWKS_URI = 'http://issuer.test/jwks';
const { DatabaseService } = require('../dist/database.service.js');
const { TrackingService } = require('../dist/tracking.service.js');
const { ReconciliationService } = require('../dist/reconciliation.service.js');
const { RabbitService } = require('../dist/rabbit.service.js');
const { TrackingController } = require('../dist/tracking.controller.js');
const { Subject } = require('rxjs');

const id = '01a1a901-5800-7000-8000-000000000001';
const eventId = '9ed155b4-1722-4ea9-b745-ed7d12a40a82';
const actual = { envioId: id, cadeteId: 'cadete.demo' };

// Simula PostgreSQL con transacciones para probar proyección, inbox y rollback sin Docker.
function base() {
  const state = { asignaciones: new Map(), eventos: new Set(), fail: false };
  const db = Object.create(DatabaseService.prototype);
  db.pool = {
    async query(sql, args) {
      if (sql.includes('SELECT cadete_id')) return { rows: state.asignaciones.has(args[0]) ? [{ cadete_id: state.asignaciones.get(args[0]) }] : [] };
      if (sql.includes('SELECT envio_id')) return { rows: [...state.asignaciones].map(([envioId, cadeteId]) => ({ envioId, cadeteId })) };
      throw Error(sql);
    },
    async connect() {
      let asignaciones, eventos;
      return {
        release() {},
        async query(sql, args) {
          if (sql === 'BEGIN') { asignaciones = new Map(state.asignaciones); eventos = new Set(state.eventos); return {}; }
          if (sql === 'COMMIT') { state.asignaciones = asignaciones; state.eventos = eventos; return {}; }
          if (sql === 'ROLLBACK') return {};
          if (state.fail) throw Error('PostgreSQL no disponible');
          if (sql.includes('INSERT INTO eventos_procesados')) {
            if (eventos.has(args[0])) return { rowCount: 0 };
            eventos.add(args[0]); return { rowCount: 1 };
          }
          if (sql.includes('DELETE FROM asignaciones WHERE NOT')) {
            for (const key of asignaciones.keys()) if (!args[0].includes(key)) asignaciones.delete(key);
          } else if (sql.includes('DELETE FROM asignaciones')) asignaciones.delete(args[0]);
          else if (sql.includes('INSERT INTO asignaciones')) asignaciones.set(args[0], args[1]);
          else throw Error(sql);
          return {};
        },
      };
    },
  };
  return { db, state };
}

test('mapas consultan la base propia aun sin Redis, RabbitMQ ni Envíos', async () => {
  const { db } = base();
  await db.aplicarEvento(eventId, 'envio.asignado', { envioId: id, mensajero: actual.cadeteId });
  const redis = { cmd: { get: async () => null } };
  const tracking = new TrackingService(redis, db);
  const fetchOriginal = global.fetch;
  global.fetch = () => { throw Error('Envíos caído'); };
  try {
    assert.equal(await tracking.cadeteDeEnvio(id), actual.cadeteId);
    assert.deepEqual(await tracking.asignaciones(), [actual]);
  } finally { global.fetch = fetchOriginal; }
});

test('inbox idempotente: duplicados no deshacen la liberación y el fallo hace rollback', async () => {
  const { db, state } = base();
  assert.equal(await db.aplicarEvento(eventId, 'envio.asignado', { envioId: id, mensajero: actual.cadeteId }), true);
  await db.aplicarEvento('9ed155b4-1722-4ea9-b745-ed7d12a40a83', 'envio.estado_actualizado', { envioId: id, estadoNuevo: 'PENDIENTE' });
  assert.equal(await db.aplicarEvento(eventId, 'envio.asignado', { envioId: id, mensajero: actual.cadeteId }), false);
  assert.equal(await db.cadeteDeEnvio(id), null);
  state.fail = true;
  await assert.rejects(db.aplicarEvento('9ed155b4-1722-4ea9-b745-ed7d12a40a84', 'envio.asignado', { envioId: id, mensajero: actual.cadeteId }));
  state.fail = false;
  assert.equal(await db.aplicarEvento('9ed155b4-1722-4ea9-b745-ed7d12a40a84', 'envio.asignado', { envioId: id, mensajero: actual.cadeteId }), true);
});

test('snapshot de Envíos reconstruye y corrige la proyección sin cambiar el estado oficial', async () => {
  const { db } = base();
  const reconciliacion = new ReconciliationService(db);
  const fetchOriginal = global.fetch;
  let vigentes = [actual];
  global.fetch = async (_url, options) => {
    assert.equal(options.headers['x-tracking-sync-secret'], 'secreto-de-prueba');
    return Response.json(vigentes);
  };
  try {
    await reconciliacion.reconciliar();
    assert.equal(await db.cadeteDeEnvio(id), actual.cadeteId);
    vigentes = [];
    await reconciliacion.reconciliar();
    assert.equal(await db.cadeteDeEnvio(id), null);
    global.fetch = async () => { throw Error('Envíos caído'); };
    await reconciliacion.reconciliar();
    assert.deepEqual(await db.asignaciones(), []);
  } finally { global.fetch = fetchOriginal; }
});

test('RabbitMQ confirma tras persistir y reencola un fallo transitorio', async () => {
  const { db, state } = base();
  const publicados = [];
  const rabbit = new RabbitService(db, { publicarFinDeEnvio: async (envioId, estado) => publicados.push({ envioId, estado }) });
  const calls = [];
  const channel = {
    ack: () => calls.push('ack'),
    nack: (_msg, _all, requeue) => calls.push(requeue ? 'requeue' : 'discard'),
  };
  const msg = { fields: { routingKey: 'envio.asignado' }, content: Buffer.from(JSON.stringify({ eventId, data: { envioId: id, mensajero: actual.cadeteId } })) };
  state.fail = true;
  await rabbit.procesar(msg, channel);
  assert.deepEqual(calls, ['requeue']);
  assert.equal(state.eventos.size, 0);
  state.fail = false;
  await rabbit.procesar(msg, channel);
  assert.deepEqual(calls, ['requeue', 'ack']);
  assert.equal(await db.cadeteDeEnvio(id), actual.cadeteId);
  await rabbit.procesar(msg, channel);
  assert.deepEqual(calls, ['requeue', 'ack', 'ack']);
  await rabbit.procesar({ fields: { routingKey: 'envio.asignado' }, content: Buffer.from('{}') }, channel);
  assert.equal(calls.at(-1), 'discard');
  const final = { fields: { routingKey: 'envio.estado_actualizado' }, content: Buffer.from(JSON.stringify({
    eventId: '9ed155b4-1722-4ea9-b745-ed7d12a40a86', data: { envioId: id, estadoNuevo: 'NO_ENTREGADO' },
  })) };
  await rabbit.procesar(final, channel);
  assert.deepEqual(publicados, [{ envioId: id, estado: 'NO_ENTREGADO' }]);
  assert.equal(await db.cadeteDeEnvio(id), null);
  await rabbit.procesar(final, channel);
  assert.equal(publicados.length, 2, 'una redelivery también debe notificar el cierre');
});

test('el evento final cierra el SSE del envío, no el stream general de cadetes', async () => {
  const posiciones = new Subject();
  const estados = new Subject();
  const tracking = {
    conexionesSse: 0,
    cadeteDeEnvio: async () => 'cadete.demo',
    ultimaPosicion: async () => null,
    stream: (cadeteId) => cadeteId ? posiciones.asObservable() : posiciones.asObservable(),
    finDeEnvio: () => estados.asObservable(),
  };
  const controller = new TrackingController(tracking);
  const eventos = [];
  let terminado = false;
  const sub = controller.streamEnvio(id).subscribe({ next: (e) => eventos.push(e), complete: () => { terminado = true; } });
  // Esperar a que se resuelva la asignación asíncrona y se instalen los listeners.
  await new Promise((resolve) => setImmediate(resolve));
  posiciones.next({ cadeteId: 'cadete.demo', lat: -34.6, lng: -58.4 });
  estados.next({ envioId: id, estado: 'ENTREGADO' });
  posiciones.next({ cadeteId: 'cadete.demo', lat: -34.7, lng: -58.5 });
  assert.equal(terminado, true);
  assert.deepEqual(eventos.map((e) => e.type ?? 'posicion'), ['posicion', 'estado_final']);
  assert.deepEqual(eventos[1].data, { estado: 'ENTREGADO' });
  sub.unsubscribe();
});
