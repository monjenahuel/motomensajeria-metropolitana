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
