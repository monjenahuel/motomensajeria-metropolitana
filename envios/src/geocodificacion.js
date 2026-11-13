// Consumidor de `envio.geocodificado` (lo publica Mapas).
//
// Cuando Envíos crea un envío solo con direcciones, las columnas lat_*/lon_* quedan en NULL.
// Mapas las geocodifica y publica el resultado; acá se persiste para que el panel del
// operador y el cadete tengan las coordenadas sin volver a consultar al servicio de mapas.
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Postgres devuelve NUMERIC como texto; se aceptan number y string.
function numero(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  if (texto === '') return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

export function crearConsumidorGeocodificacion({ pool, suscribir, log = console }) {
  async function guardarCoordenadas({ data }) {
    const envioId = String(data?.envioId ?? '');
    if (!UUID_V7.test(envioId)) {
      log.warn(`Geocodificación ignorada: id inválido (${envioId})`);
      return;
    }

    const latOrigen = numero(data?.origen?.lat);
    const lonOrigen = numero(data?.origen?.lon);
    const latDestino = numero(data?.destino?.lat);
    const lonDestino = numero(data?.destino?.lon);
    if ([latOrigen, lonOrigen, latDestino, lonDestino].every((v) => v === null)) {
      log.warn(`Geocodificación ignorada: el evento ${envioId} no trae coordenadas`);
      return;
    }

    const { rowCount } = await pool.query(
      `UPDATE envios
          SET lat_origen = COALESCE($2, lat_origen),
              lon_origen = COALESCE($3, lon_origen),
              lat_destino = COALESCE($4, lat_destino),
              lon_destino = COALESCE($5, lon_destino),
              actualizado_en = now()
        WHERE id = $1`,
      [envioId, latOrigen, lonOrigen, latDestino, lonDestino]
    );

    if (rowCount === 0) {
      log.warn(`Geocodificación ignorada: no existe el envío ${envioId}`);
      return;
    }
    log.info(`Envío ${envioId}: coordenadas guardadas desde Mapas`);
  }

  return {
    guardarCoordenadas,
    iniciar: () => suscribir('envios.geocodificacion', ['envio.geocodificado'], guardarCoordenadas),
  };
}
