// Simulador autenticado: cada cadete.sim.NNN reporta su propio GPS a Tracking.
// Compose prepara previamente los usuarios de prueba en Keycloak.
//
// Los datos simulados usan el mismo formato que producción:
//   - cadeteId: username de Keycloak (ej. cadete.sim.002), obtenido del JWT
//   - posiciones: lat/lng/rumbo/ts, igual que la app del cadete
// Las asignaciones envío ↔ cadete no se simulan acá: las gestiona el módulo
// Operador del MS de Envíos y llegan a Tracking por RabbitMQ.
const API = process.env.API ?? 'http://localhost:3000';
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8081/realms/motomensajeria/protocol/openid-connect/token';
const CLIENT_ID = process.env.CLIENT_ID ?? 'motomensajeria-web';
const PASSWORD = process.env.SIM_PASSWORD;
const N = Number(process.env.N ?? 600);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 5000); // el requisito: cada 5 s
const SPEED_MS = Number(process.env.SPEED_MS ?? 40);         // m/s simulados (acelerado para que se note en el mapa)
const SILENCIO = Number(process.env.SILENCIO ?? 0.01);       // prob. por reporte de "perder señal" unos 20-40 s

const rand = (a, b) => a + Math.random() * (b - a);
const pad = (n) => String(n).padStart(3, '0');
const M_POR_GRADO_LAT = 111_000;

if (!PASSWORD) throw new Error('Definí SIM_PASSWORD para los cadetes simulados');
if (!Number.isInteger(N) || N < 1 || N > 999 || !Number.isFinite(INTERVAL_MS) || INTERVAL_MS <= 0) {
  throw new Error('N debe estar entre 1 y 999 e INTERVAL_MS debe ser positivo');
}

// Contorno aproximado del AMBA (tierra firme, sin el Río de la Plata). Formato [lat, lng]
const AMBA = [
  [-34.30, -58.95], [-34.38, -58.62], [-34.47, -58.50], [-34.53, -58.445],
  [-34.57, -58.385], [-34.62, -58.35], [-34.66, -58.33], [-34.72, -58.24],
  [-34.79, -58.13], [-34.88, -58.20], [-35.00, -58.45], [-34.98, -58.85],
  [-34.70, -59.05], [-34.45, -59.05],
];
const LATS = AMBA.map((p) => p[0]), LNGS = AMBA.map((p) => p[1]);
const BOX = { latMin: Math.min(...LATS), latMax: Math.max(...LATS), lngMin: Math.min(...LNGS), lngMax: Math.max(...LNGS) };

// ¿El punto está dentro del polígono? (ray casting)
function dentro(lat, lng) {
  let d = false;
  for (let i = 0, j = AMBA.length - 1; i < AMBA.length; j = i++) {
    const [yi, xi] = AMBA[i], [yj, xj] = AMBA[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}
function puntoAlAzar() {
  for (;;) {
    const lat = rand(BOX.latMin, BOX.latMax), lng = rand(BOX.lngMin, BOX.lngMax);
    if (dentro(lat, lng)) return { lat, lng };
  }
}

const cadetes = Array.from({ length: N }, (_, i) => {
  const n = i + 1;
  return {
    id: `cadete.sim.${pad(n)}`,
    ...puntoAlAzar(),
    rumbo: rand(0, 360),
    silencioHasta: 0,
    token: null,
    refreshToken: null,
    vence: 0,
  };
});

let enviados = 0, errores = 0;

async function solicitarToken(c, grant) {
  const params = new URLSearchParams({ client_id: CLIENT_ID, grant_type: grant });
  if (grant === 'refresh_token') params.set('refresh_token', c.refreshToken);
  else { params.set('username', c.id); params.set('password', PASSWORD); }
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Keycloak rechazó ${c.id}: HTTP ${res.status} (${error.error_description ?? error.error ?? 'sin detalle'})`);
  }
  const data = await res.json();
  c.token = data.access_token;
  c.refreshToken = data.refresh_token;
  // Renovaciones escalonadas: no volver a autenticar 600 usuarios a la vez.
  c.vence = Date.now() + data.expires_in * 1000 - Math.min(rand(30_000, 90_000), data.expires_in * 500);
}

async function autenticar(c) {
  if (c.token && Date.now() < c.vence) return c.token;
  if (c.refreshToken) {
    try { await solicitarToken(c, 'refresh_token'); return c.token; }
    catch { c.refreshToken = null; }
  }
  await solicitarToken(c, 'password');
  return c.token;
}

async function autenticarTodos() {
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(10, N) }, async () => {
    while (siguiente < N) await autenticar(cadetes[siguiente++]);
  }));
}

function avanzar(c) {
  c.rumbo = (c.rumbo + rand(-25, 25) + 360) % 360; // giros suaves
  const d = (SPEED_MS * INTERVAL_MS) / 1000;
  const rad = (c.rumbo * Math.PI) / 180;
  const lat = c.lat + (Math.cos(rad) * d) / M_POR_GRADO_LAT;
  const lng = c.lng + (Math.sin(rad) * d) / (M_POR_GRADO_LAT * Math.cos((c.lat * Math.PI) / 180));
  if (dentro(lat, lng)) { c.lat = lat; c.lng = lng; }
  else c.rumbo = (c.rumbo + 180 + rand(-40, 40) + 360) % 360;   // llegó al borde (o al río): da la vuelta
}

async function reportarUna(c) {
  avanzar(c);
  if (Date.now() < c.silencioHasta) return;            // sin señal: no reporta
  if (Math.random() < SILENCIO) { c.silencioHasta = Date.now() + rand(20_000, 40_000); return; }
  try {
    const token = await autenticar(c);
    const r = await fetch(`${API}/tracking/ubicaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lat: c.lat, lng: c.lng, rumbo: Math.round(c.rumbo), ts: Date.now() }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401) { c.token = null; c.refreshToken = null; }
    r.ok ? enviados++ : errores++;
  } catch { errores++; }
}

async function reportar(c) {
  if (c.enVuelo) return; // No solapar reportes ni renovaciones si la red está lenta.
  c.enVuelo = true;
  try { await reportarUna(c); }
  finally { c.enVuelo = false; }
}

async function esperarAPI() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${API}/tracking/metrics`)).ok) return; } catch {}
    console.log(`Esperando al Tracking MS en ${API}...`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('El Tracking MS no responde');
}

async function main() {
  await esperarAPI();
  await autenticarTodos();
  console.log(`${N} cadetes reportando cada ${INTERVAL_MS / 1000}s (~${(N / (INTERVAL_MS / 1000)).toFixed(0)} reportes/s) -> ${API}`);
  console.log('Las asignaciones envío ↔ cadete se crean desde el módulo Operador del MS de Envíos.');
  // Desfasados dentro del intervalo, como pasaría en la vida real (no todos al mismo tiempo)
  cadetes.forEach((c) => setTimeout(() => { reportar(c); setInterval(() => reportar(c), INTERVAL_MS); }, rand(0, INTERVAL_MS)));
  setInterval(() => { console.log(`enviados=${enviados} errores=${errores}`); }, 10_000);
}
main().catch((e) => { console.error(e); process.exit(1); });
