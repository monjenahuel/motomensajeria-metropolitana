/**
 * Cliente HTTP para comunicación unificada con el API Gateway.
 * Todas las peticiones de negocio e identidad se dirigen a la URL del Gateway (:3000).
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
export const MAPAS_URL = `${API_BASE_URL.replace(/\/+$/, '')}/mapas`;

export async function abrirSesionMapa(token) {
  const res = await fetch(`${MAPAS_URL}/sesion`, {
    method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('No se pudo autorizar el mapa. Iniciá sesión nuevamente.');
}

export function cerrarSesionMapa() {
  return fetch(`${MAPAS_URL}/sesion`, { method: 'DELETE', credentials: 'include' });
}

/**
 * Autentica un usuario solicitando un token OIDC a través del API Gateway.
 */
export async function login(username, password) {
  const res = await fetch(`${API_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, grant_type: 'password' }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.title || 'Error de autenticación');
  }
  return data;
}

/**
 * Obtiene la identidad y roles del usuario autenticado.
 */
export async function getMe(token) {
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('Sesión expirada o token inválido');
  }
  return await res.json();
}

/**
 * Obtiene la lista de envíos asociados al usuario logueado.
 */
export async function getEnvios(token) {
  const res = await fetch(`${API_BASE_URL}/envios`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || 'Error al obtener los envíos');
  }
  return await res.json();
}

/**
 * Registra un nuevo envío y publica el evento correspondiente.
 */
export async function crearEnvio(token, payload) {
  const res = await fetch(`${API_BASE_URL}/envios`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.title || 'Error al registrar el pedido');
  }
  return data;
}

/**
 * Consulta el detalle de un envío incluyendo su historial de auditoría.
 */
export async function getEnvioDetalle(token, id) {
  const res = await fetch(`${API_BASE_URL}/envios/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('Error al consultar el detalle del envío');
  }
  return await res.json();
}
