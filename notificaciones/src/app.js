import express from 'express';

// authenticate / requireRole / problem se inyectan (en producción vienen de auth.js) para poder probar sin Keycloak.
export function crearApp({ notificaciones, authenticate, requireRole, problem }) {
  const app = express();

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notificaciones' }));

  // Todo lo que sigue exige token válido (el servicio no confía ciegamente en el gateway)
  app.use(authenticate);

  // Stream SSE de avisos y eventos en tiempo real según el rol autenticado.
  app.get('/notificaciones/stream', requireRole('cliente', 'cadete', 'operador', 'administrador'), (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');

    const roles = req.user.roles ?? [];
    const esStaff = roles.some((r) => ['operador', 'administrador'].includes(r));
    const esCadete = roles.includes('cadete') && !esStaff;

    const enviar = (n) => {
      if (!esStaff) {
        if (esCadete) {
          if (n.mensajero && n.mensajero !== req.user.username) return;
          if (!n.mensajero && !['envio.asignado', 'envio.estado_actualizado'].includes(n.tipo)) return;
        } else if (n.cliente !== req.user.username) {
          return;
        }
      }
      res.write(`event: notificacion\ndata: ${JSON.stringify(n)}\n\n`);
    };

    const desuscribir = notificaciones.suscribir(enviar);
    const latido = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(latido);
      desuscribir();
    });
  });

  // El cliente ve solo sus avisos; el staff puede ver todos.
  app.get('/notificaciones', requireRole('cliente', 'operador', 'administrador'), (req, res) => {
    const desde = req.query.desde === undefined ? 0 : Number(req.query.desde);
    if (!Number.isInteger(desde) || desde < 0) {
      return problem(res, 400, 'Parámetro inválido', '"desde" debe ser un entero mayor o igual a 0.', req.originalUrl);
    }
    const esStaff = req.user.roles.some((r) => ['operador', 'administrador'].includes(r));
    res.json(notificaciones.listar({
      cliente: esStaff ? undefined : req.user.username,
      envioId: req.query.envioId,
      desde,
    }));
  });

  app.use((req, res) => problem(res, 404, 'Ruta no encontrada', `No existe la ruta ${req.method} ${req.originalUrl}.`, req.originalUrl));
  app.use((err, req, res, next) => {
    console.error(err);
    problem(res, 500, 'Error interno', 'Ocurrió un error inesperado.', req.originalUrl);
  });
  return app;
}
