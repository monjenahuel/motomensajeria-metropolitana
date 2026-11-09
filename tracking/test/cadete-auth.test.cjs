require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPair, exportJWK, SignJWT } = require('jose');

test('Tracking valida JWT, rol e identidad propia antes de guardar GPS', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    process.env.KEYCLOAK_ISSUER = 'http://keycloak.example/realms/test';
    process.env.KEYCLOAK_JWKS_URI = `http://127.0.0.1:${server.address().port}/certs`;
    process.env.KEYCLOAK_AUDIENCE = 'motomensajeria-api';
    const { CadeteAuthGuard } = require('../dist/cadete-auth.guard.js');
    const guard = new CadeteAuthGuard();
    const token = (roles, extra = {}, audience = process.env.KEYCLOAK_AUDIENCE) => new SignJWT({ preferred_username: 'cadete.real', realm_access: { roles }, ...extra })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuedAt().setExpirationTime('5m')
      .setIssuer(process.env.KEYCLOAK_ISSUER).setAudience(audience)
      .sign(privateKey);
    const contexto = (req) => ({ switchToHttp: () => ({ getRequest: () => req }) });

    await assert.rejects(guard.canActivate(contexto({ headers: {}, body: {} })), { status: 401 });
    await assert.rejects(guard.canActivate(contexto({ headers: { authorization: 'Bearer falsificado' }, body: {} })), { status: 401 });
    await assert.rejects(guard.canActivate(contexto({ headers: { authorization: `Bearer ${await token(['cadete'], {}, 'otra-api')}` }, body: {} })), { status: 401 });
    await assert.rejects(guard.canActivate(contexto({ headers: { authorization: `Bearer ${await token(['cliente'])}` }, body: {} })), { status: 403 });
    await assert.rejects(guard.canActivate(contexto({ headers: { authorization: `Bearer ${await token(['cadete'], { preferred_username: null })}` }, body: {} })), { status: 401 });
    const req = { headers: { authorization: `Bearer ${await token(['cadete'])}` }, body: { cadeteId: 'otra.persona', lat: -34.6, lng: -58.4 } };
    assert.equal(await guard.canActivate(contexto(req)), true);
    assert.equal(req.body.cadeteId, 'cadete.real');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
