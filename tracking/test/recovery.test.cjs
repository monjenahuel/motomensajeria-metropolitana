require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TRACKING_SYNC_SECRET = 'secreto-de-prueba';
process.env.RABBITMQ_URL = 'amqp://localhost';
process.env.RABBITMQ_EXCHANGE = 'test.events';
process.env.RABBITMQ_QUEUE = 'test.tracking';
process.env.RABBITMQ_RECONNECT_MS = '1';
const { DatabaseService } = require('../dist/database.service.js');
const { TrackingService } = require('../dist/tracking.service.js');
const { ReconciliationService } = require('../dist/reconciliation.service.js');
const { RabbitService } = require('../dist/rabbit.service.js');

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
  const rabbit = new RabbitService(db);
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
});
