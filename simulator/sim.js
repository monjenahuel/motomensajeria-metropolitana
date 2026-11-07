// Simulador de cadetes: cada uno reporta su GPS al Tracking MS cada INTERVAL_MS.
// Uso: API=http://localhost:3000 N=25 node sim.js
//
// Los datos simulados usan el mismo formato que producción:
//   - cadeteId: username de Keycloak (ej. cadete.demo, cadete.sim.002)
//   - posiciones: lat/lng/rumbo/ts, igual que la app del cadete
// Las asignaciones envío ↔ cadete no se simulan acá: las gestiona el módulo
// Operador del MS de Envíos y llegan a Tracking por RabbitMQ.
const API = process.env.API ?? 'http://localhost:3000';
const N = Number(process.env.N ?? 25);                      // cantidad de cadetes (probá 600)
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 5000); // el requisito: cada 5 s
const SPEED_MS = Number(process.env.SPEED_MS ?? 40);         // m/s simulados (acelerado para que se note en el mapa)
const SILENCIO = Number(process.env.SILENCIO ?? 0.01);       // prob. por reporte de "perder señal" unos 20-40 s

const rand = (a, b) => a + Math.random() * (b - a);
const pad = (n) => String(n).padStart(3, '0');
const M_POR_GRADO_LAT = 111_000;

const CADETE_DEMO = 'cadete.demo';

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
  const esDemo = n === 1;   // el primer cadete es el usuario real cadete.demo
  return {
    id: esDemo ? CADETE_DEMO : `cadete.sim.${pad(n)}`,
    ...puntoAlAzar(),
    rumbo: rand(0, 360),
    silencioHasta: 0,
  };
});

let enviados = 0, errores = 0;

function avanzar(c) {
  c.rumbo = (c.rumbo + rand(-25, 25) + 360) % 360; // giros suaves
  const d = (SPEED_MS * INTERVAL_MS) / 1000;
  const rad = (c.rumbo * Math.PI) / 180;
  const lat = c.lat + (Math.cos(rad) * d) / M_POR_GRADO_LAT;
  const lng = c.lng + (Math.sin(rad) * d) / (M_POR_GRADO_LAT * Math.cos((c.lat * Math.PI) / 180));
  if (dentro(lat, lng)) { c.lat = lat; c.lng = lng; }
  else c.rumbo = (c.rumbo + 180 + rand(-40, 40) + 360) % 360;   // llegó al borde (o al río): da la vuelta
}

async function reportar(c) {
  avanzar(c);
  if (Date.now() < c.silencioHasta) return;            // sin señal: no reporta
  if (Math.random() < SILENCIO) { c.silencioHasta = Date.now() + rand(20_000, 40_000); return; }
  try {
    const r = await fetch(`${API}/tracking/ubicaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cadeteId: c.id, lat: c.lat, lng: c.lng, rumbo: Math.round(c.rumbo), ts: Date.now() }),
    });
    r.ok ? enviados++ : errores++;
  } catch { errores++; }
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
  console.log(`${N} cadetes reportando cada ${INTERVAL_MS / 1000}s (~${(N / (INTERVAL_MS / 1000)).toFixed(0)} reportes/s) -> ${API}`);
  console.log('Las asignaciones envío ↔ cadete se crean desde el módulo Operador del MS de Envíos.');
  // Desfasados dentro del intervalo, como pasaría en la vida real (no todos al mismo tiempo)
  cadetes.forEach((c) => setTimeout(() => { reportar(c); setInterval(() => reportar(c), INTERVAL_MS); }, rand(0, INTERVAL_MS)));
  setInterval(() => { console.log(`enviados=${enviados} errores=${errores}`); }, 10_000);
}
main().catch((e) => { console.error(e); process.exit(1); });