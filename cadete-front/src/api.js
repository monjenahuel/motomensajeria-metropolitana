import { API_URL } from './config.js';
import { accessToken, logout, refrescarSesion } from './session.js';

export class ApiError extends Error {
  constructor(message, status, title) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
  }
}

async function leerCuerpo(respuesta) {
  const tipo = respuesta.headers.get('content-type') || '';
  if (tipo.includes('application/json') || tipo.includes('application/problem+json')) {
    return respuesta.json().catch(() => ({}));
  }
  return respuesta.text().catch(() => '');
}

async function ejecutar(path, options) {
  const token = await accessToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  return fetch(`${API_URL}${path}`, { ...options, headers });
}

/** Cliente HTTP del panel: agrega el token, renueva la sesión y traduce Problem Details. */
export async function api(path, options = {}) {
  let respuesta = await ejecutar(path, options);

  // Token vencido o revocado: se intenta un refresh forzado y se reintenta una vez.
  if (respuesta.status === 401) {
    try {
      await refrescarSesion(true);
      respuesta = await ejecutar(path, options);
    } catch {
      logout();
      throw new ApiError('La sesión expiró. Volvé a iniciar sesión.', 401, 'No autenticado');
    }
  }

  const data = await leerCuerpo(respuesta);

  if (!respuesta.ok) {
    const detalle = data?.detail
      || data?.message
      || (typeof data === 'string' ? data : '')
      || `Error ${respuesta.status}`;
    throw new ApiError(detalle, respuesta.status, data?.title || 'Error');
  }

  return data;
}

/** Suscripción SSE a eventos de envíos vía Gateway (/notificaciones/stream). */
export async function suscribirEventos({ onEvento, onEstado, signal }) {
  while (!signal.aborted) {
    try {
      let respuesta = await ejecutar('/notificaciones/stream', {
        signal,
        headers: { Accept: 'text/event-stream' },
      });
      if (respuesta.status === 401) {
        await refrescarSesion(true);
        respuesta = await ejecutar('/notificaciones/stream', {
          signal,
          headers: { Accept: 'text/event-stream' },
        });
      }
      if (!respuesta.ok || !respuesta.body) {
        throw new Error(`HTTP ${respuesta.status}`);
      }

      onEstado?.('en-vivo');
      const reader = respuesta.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const bloques = buffer.split('\n\n');
        buffer = bloques.pop() ?? '';
        for (const bloque of bloques) {
          const linea = bloque.split('\n').find((l) => l.startsWith('data:'));
          if (!linea) continue;
          try {
            onEvento(JSON.parse(linea.slice(5).trim()));
          } catch {
            // Ignora frames no JSON (pings/comentarios)
          }
        }
      }
    } catch {
      if (signal.aborted) return;
      onEstado?.('reconectando');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
