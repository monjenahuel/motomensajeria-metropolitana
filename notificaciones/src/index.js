import { conectarBroker } from './broker.js';
import { authenticate, requireRole, problem } from './auth.js';
import { crearNotificaciones } from './handlers.js';
import { crearApp } from './app.js';

const { RABBITMQ_URL, EXCHANGE_NAME } = process.env;
if (!RABBITMQ_URL || !EXCHANGE_NAME) throw new Error('Faltan las variables RABBITMQ_URL y/o EXCHANGE_NAME');

const notificaciones = crearNotificaciones();
const broker = await conectarBroker({ url: RABBITMQ_URL, exchange: EXCHANGE_NAME });

await broker.suscribir(
  'notificaciones.cliente',
  ['envio.creado', 'envio.asignado', 'envio.estado_actualizado', 'envio.eta_estimado', 'envio.geocodificacion_fallida'],
  async (env) => { notificaciones.procesar(env); },
);

const port = Number(process.env.PORT ?? 3000);
crearApp({ notificaciones, authenticate, requireRole, problem })
  .listen(port, () => console.log(`Servicio de notificaciones escuchando en el puerto ${port}`));
