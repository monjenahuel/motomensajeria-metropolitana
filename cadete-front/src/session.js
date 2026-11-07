import { API_URL, KEYCLOAK_CLIENT_ID } from './config.js';

const STORAGE_KEY = 'mm.cadete.session';
const ROLES_CADETE = ['cadete'];

let actual = leerSesion();
let refrescoEnCurso = null;
const listeners = new Set();

function leerSesion() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function guardar(sesion) {
  actual = sesion;
  try {
    if (sesion) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sesion));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage puede fallar en modo privado; la sesión sigue en memoria.
  }
  listeners.forEach((fn) => fn());
}

export function getSession() {
  return actual;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Decodifica el payload del JWT (sin validar la firma: eso lo hace el gateway). */
function decodificarJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
    const binario = atob(base64 + relleno);
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function normalizar(respuesta) {
  const claims = decodificarJwt(respuesta.access_token);
  return {
    accessToken: respuesta.access_token,
    refreshToken: respuesta.refresh_token || null,
    expiresAt: Date.now() + Number(respuesta.expires_in || 300) * 1000,
    user: {
      username: claims.preferred_username || claims.name || 'cadete',
      nombre: [claims.given_name, claims.family_name].filter(Boolean).join(' ')
        || claims.name
        || claims.preferred_username
        || 'Cadete',
      roles: claims.realm_access?.roles || [],
    },
  };
}

async function pedirToken(params) {
  const respuesta = await fetch(`${API_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });

  const data = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const detalle = data.error_description || data.error || `No se pudo iniciar sesión (${respuesta.status}).`;
    throw new Error(detalle);
  }
  return normalizar(data);
}

export async function login(username, password) {
  const sesion = await pedirToken({
    grant_type: 'password',
    client_id: KEYCLOAK_CLIENT_ID,
    username: username.trim(),
    password,
  });

  if (!sesion.user.roles.some((rol) => ROLES_CADETE.includes(rol))) {
    throw new Error('El usuario no tiene rol de cadete.');
  }

  guardar(sesion);
  return sesion;
}

/** Renueva la sesión con el refresh token. Si falla, cierra la sesión. */
export async function refrescarSesion(forzar = false) {
  if (!actual) throw new Error('No hay una sesión activa.');

  // Todavía es válido: no hace falta ir a Keycloak.
  if (!forzar && Date.now() < actual.expiresAt - 30_000) return actual;

  if (!actual.refreshToken) {
    guardar(null);
    throw new Error('La sesión expiró. Volvé a iniciar sesión.');
  }

  if (!refrescoEnCurso) {
    refrescoEnCurso = pedirToken({
      grant_type: 'refresh_token',
      client_id: KEYCLOAK_CLIENT_ID,
      refresh_token: actual.refreshToken,
    })
      .then((sesion) => {
        if (!sesion.user.roles.includes('cadete')) throw new Error('El usuario no tiene rol de cadete.');
        guardar(sesion);
        return sesion;
      })
      .catch((err) => {
        guardar(null);
        throw err;
      })
      .finally(() => {
        refrescoEnCurso = null;
      });
  }

  return refrescoEnCurso;
}

export async function accessToken() {
  const sesion = await refrescarSesion(false);
  return sesion.accessToken;
}

export function logout() {
  guardar(null);
}
