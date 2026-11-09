import http from 'node:http';
import { conectarBroker } from './broker.js';
import { crearClienteMapas } from './cliente-mapas.js';
import { crearHandlers } from './handlers.js';

const { RABBITMQ_URL, EXCHANGE_NAME, MAPAS_URL } = process.env;
if (!RABBITMQ_URL || !EXCHANGE_NAME || !MAPAS_URL) {
  throw new Error('Faltan las variables RABBITMQ_URL, EXCHANGE_NAME y/o MAPAS_URL');
}

const mapas = crearClienteMapas({ baseUrl: MAPAS_URL });
const broker = await conectarBroker({ url: RABBITMQ_URL, exchange: EXCHANGE_NAME });
const handlers = crearHandlers({
  mapas,
  publicar: broker.publicar,
  retiroMin: Number(process.env.TIEMPO_RETIRO_MIN ?? 10),
  velocidadRespaldoKmh: Number(process.env.VELOCIDAD_RESPALDO_KMH ?? 25),
});

await broker.suscribir('mapas.envios', Object.keys(handlers), async (env) => { await handlers[env.tipo]?.(env); });

// Solo para health y para la verificación del NFR-3 (no se expone por el gateway)
const port = Number(process.env.PORT ?? 3000);
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', service: 'mapas' }));
  if (req.url === '/stats') return res.end(JSON.stringify(mapas.stats));
  res.statusCode = 404; res.end(JSON.stringify({ error: 'ruta no encontrada' }));
}).listen(port, () => console.log(`Servicio de mapas escuchando en el puerto ${port} (mapas externo: ${MAPAS_URL})`));
