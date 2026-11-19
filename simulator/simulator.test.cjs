const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const dir = __dirname;
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('prepara usuarios y reporta GPS con identidad y tokens individuales', async () => {
  const users = new Map();
  const reportes = new Map();
  let renovaciones = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const url = new URL(req.url, 'http://localhost');
    const json = (status, data, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === '/realms/master/protocol/openid-connect/token') {
      return json(200, { access_token: 'admin', expires_in: 60 });
    }
    if (url.pathname === '/realms/demo/protocol/openid-connect/token') {
      const params = new URLSearchParams(body);
      const username = params.get('grant_type') === 'refresh_token'
        ? params.get('refresh_token').slice('refresh-'.length) : params.get('username');
      if (params.get('grant_type') === 'refresh_token') renovaciones++;
      const u = users.get(username);
      if (!u || !u.email || !u.firstName || !u.lastName ||
          (params.get('grant_type') === 'password' && params.get('password') !== u.password)) {
        return json(401, { error: 'invalid_grant' });
      }
      return json(200, { access_token: `token-${username}`, refresh_token: `refresh-${username}`, expires_in: 1 });
    }
    if (url.pathname === '/admin/realms/demo/roles/cadete') return json(200, { id: 'role-id', name: 'cadete' });
    if (url.pathname === '/admin/realms/demo/users' && req.method === 'GET') {
      const u = users.get(url.searchParams.get('username'));
      return json(200, u ? [{ id: u.id, username: u.username }] : []);
    }
    if (url.pathname === '/admin/realms/demo/users' && req.method === 'POST') {
      const data = JSON.parse(body);
      const id = `id-${data.username}`;
      users.set(data.username, { id, username: data.username, password: data.credentials[0].value,
        email: data.email, firstName: data.firstName, lastName: data.lastName });
      res.writeHead(201, { location: `http://localhost/admin/realms/demo/users/${id}` });
      return res.end();
    }
    const userMatch = /^\/admin\/realms\/demo\/users\/([^/]+)(?:\/(reset-password|role-mappings\/realm))?$/.exec(url.pathname);
    if (userMatch) {
      const u = [...users.values()].find((item) => item.id === userMatch[1]);
      if (userMatch[2] === 'reset-password') u.password = JSON.parse(body).value;
      if (!userMatch[2]) Object.assign(u, JSON.parse(body));
      return json(204, {});
    }
    if (url.pathname === '/tracking/metrics') return json(200, {});
    if (url.pathname === '/tracking/ubicaciones') {
      const username = req.headers.authorization?.slice('Bearer token-'.length);
      if (!users.has(username) || 'cadeteId' in JSON.parse(body)) return json(401, {});
      reportes.set(username, (reportes.get(username) ?? 0) + 1);
      return json(202, {});
    }
    json(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  function ejecutar(script, env) {
    const child = spawn(process.execPath, [path.join(dir, script)], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    child.stdout.on('data', (chunk) => { salida += chunk; });
    child.stderr.on('data', (chunk) => { salida += chunk; });
    return { child, salida: () => salida, fin: new Promise((resolve) => child.on('close', resolve)) };
  }

  let sim;
  try {
    const env = {
      KC_URL: base, KC_REALM: 'demo', KC_ADMIN_USER: 'admin', KC_ADMIN_PASSWORD: 'secret',
      SIM_PASSWORD: 'demo-pass', SIM_CADETES: '2',
    };
    const primero = ejecutar('provisionar-cadetes.js', env);
    assert.equal(await primero.fin, 0, primero.salida());
    // Reproduce el estado de usuarios creados sin perfil por el script anterior.
    users.get('cadete.sim.002').email = undefined;
    const segundo = ejecutar('provisionar-cadetes.js', env);
    assert.equal(await segundo.fin, 0, segundo.salida());
    assert.equal(users.size, 2);
    assert.equal(users.get('cadete.sim.002').email, 'cadete.sim.002@motomensajeria.local');
    sim = ejecutar('sim.js', {
      SIM_PASSWORD: 'demo-pass', API: base,
      AUTH_URL: `${base}/realms/demo/protocol/openid-connect/token`,
      N: '2', INTERVAL_MS: '40', SILENCIO: '0',
    });
    const deadline = Date.now() + 6000;
    while ((reportes.size !== 2 || renovaciones < 2) && Date.now() < deadline) {
      if (sim.child.exitCode !== null) throw new Error(sim.salida());
      await esperar(50);
    }
    assert.equal(reportes.size, 2, sim.salida());
    assert.ok(renovaciones >= 2, sim.salida());
  } finally {
    if (sim) { sim.child.kill(); await sim.fin; }
    await new Promise((resolve) => server.close(resolve));
  }
});
