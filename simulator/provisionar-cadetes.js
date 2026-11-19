// Crea usuarios de prueba cadete.sim.001..N en Keycloak y les asigna el rol cadete.
// También corre como servicio de preparación en Compose, antes del simulador.
const base = (process.env.KC_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const realm = process.env.KC_REALM ?? 'motomensajeria';
const { KC_ADMIN_USER, KC_ADMIN_PASSWORD, SIM_PASSWORD } = process.env;
const total = Number(process.env.SIM_CADETES ?? 600);

if (!KC_ADMIN_USER || !KC_ADMIN_PASSWORD || !SIM_PASSWORD) {
  throw new Error('Definí KC_ADMIN_USER, KC_ADMIN_PASSWORD y SIM_PASSWORD');
}
if (!Number.isInteger(total) || total < 1 || total > 999) {
  throw new Error('SIM_CADETES debe ser un entero entre 1 y 999');
}

let token;
let vence = 0;
let renovacion;

async function obtenerToken(forzar = false) {
  if (!forzar && token && Date.now() < vence - 30_000) return token;
  if (!renovacion) {
    renovacion = (async () => {
      const res = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password', client_id: 'admin-cli',
          username: KC_ADMIN_USER, password: KC_ADMIN_PASSWORD,
        }),
      });
      if (!res.ok) throw new Error(`No se pudo autenticar el administrador: HTTP ${res.status}`);
      const data = await res.json();
      token = data.access_token;
      vence = Date.now() + data.expires_in * 1000;
      return token;
    })().finally(() => { renovacion = undefined; });
  }
  return renovacion;
}

async function admin(path, options = {}, reintentar = true) {
  const bearer = await obtenerToken();
  const res = await fetch(`${base}/admin/realms/${encodeURIComponent(realm)}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
  });
  if (res.status === 401 && reintentar) {
    token = undefined;
    await obtenerToken(true);
    return admin(path, options, false);
  }
  return res;
}

async function exigir(res, accion) {
  if (!res.ok) throw new Error(`${accion}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

const rol = await (await exigir(await admin('/roles/cadete'), 'Obtener rol cadete')).json();
let creados = 0;
let existentes = 0;
let terminados = 0;

async function crear(i) {
  const username = `cadete.sim.${String(i).padStart(3, '0')}`;
  const perfil = {
    username,
    email: `${username}@motomensajeria.local`,
    firstName: 'Cadete',
    lastName: `Simulado ${String(i).padStart(3, '0')}`,
    emailVerified: true,
    requiredActions: [],
  };
  const busqueda = await exigir(
    await admin(`/users?username=${encodeURIComponent(username)}&exact=true`),
    `Buscar ${username}`,
  );
  let usuario = (await busqueda.json()).find((u) => u.username === username);
  if (!usuario) {
    const res = await admin('/users', {
      method: 'POST',
      body: JSON.stringify({
        ...perfil, enabled: true,
        credentials: [{ type: 'password', value: SIM_PASSWORD, temporary: false }],
      }),
    });
    // Si se ejecuta dos veces simultáneamente, otra instancia puede haberlo creado.
    if (res.status === 409) {
      const repetida = await exigir(
        await admin(`/users?username=${encodeURIComponent(username)}&exact=true`),
        `Buscar ${username} después de conflicto`,
      );
      usuario = (await repetida.json()).find((u) => u.username === username);
      if (!usuario) throw new Error(`No se encontró ${username} después del conflicto`);
      existentes++;
    } else {
      await exigir(res, `Crear ${username}`);
      const id = res.headers.get('location')?.split('/').at(-1);
      if (!id) throw new Error(`Keycloak no devolvió el ID de ${username}`);
      usuario = { id };
      creados++;
    }
  } else {
    existentes++;
  }
  // Keycloak exige un perfil completo antes de permitir el grant password.
  // También repara los usuarios creados por versiones anteriores del script.
  await exigir(await admin(`/users/${encodeURIComponent(usuario.id)}`, {
    method: 'PUT', body: JSON.stringify(perfil),
  }), `Completar perfil de ${username}`);
  // La contraseña de los usuarios de prueba se sincroniza en cada arranque:
  // cambiar SIM_PASSWORD en .env no deja al simulador bloqueado por usuarios viejos.
  if (usuario.username) {
    await exigir(await admin(`/users/${encodeURIComponent(usuario.id)}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: SIM_PASSWORD, temporary: false }),
    }), `Actualizar contraseña de ${username}`);
  }
  await exigir(await admin(`/users/${encodeURIComponent(usuario.id)}/role-mappings/realm`, {
    method: 'POST', body: JSON.stringify([{ id: rol.id, name: rol.name }]),
  }), `Asignar rol a ${username}`);
  terminados++;
  if (terminados % 50 === 0 || terminados === total) {
    console.log(`${terminados}/${total} usuarios preparados`);
  }
}

// Diez solicitudes concurrentes para no saturar Keycloak al preparar la demo.
let siguiente = 1;
await Promise.all(Array.from({ length: Math.min(10, total) }, async () => {
  while (siguiente <= total) await crear(siguiente++);
}));
console.log(`Listo: ${creados} creados, ${existentes} ya existentes.`);
