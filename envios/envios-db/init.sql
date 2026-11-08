-- Corre automáticamente solo la PRIMERA vez que se crea el volumen pgdata.
-- Arquitectura de Software 1 - UNAHUR
-- Esquema de Persistencia Relacional: Microservicio de Envíos (Escenario 3B)

-- Genera UUID v7 sin extensiones externas:
--   48 bits de timestamp Unix en ms + version 7 + variante RFC 4122 + 62 bits aleatorios.
-- Al ser ordenable por tiempo, se puede usar como clave primaria y para ORDER BY id.
CREATE OR REPLACE FUNCTION uuid_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  ts_bytes   bytea;
  rand_bytes bytea;
  out_bytes  bytea;
BEGIN
  -- int8send devuelve 8 bytes big-endian; los últimos 6 son el timestamp en ms.
  ts_bytes := substring(
    int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    FROM 3 FOR 6
  );

  -- gen_random_uuid() ya viene en PostgreSQL 13+; no requiere pgcrypto.
  rand_bytes := uuid_send(gen_random_uuid());
  out_bytes := ts_bytes || substring(rand_bytes FROM 1 FOR 10);

  -- Version 7: nibble alto del byte 6.
  out_bytes := set_byte(out_bytes, 6, (get_byte(out_bytes, 6) & 15) | 112);
  -- Variante RFC 4122: bits altos del byte 8 en 10.
  out_bytes := set_byte(out_bytes, 8, (get_byte(out_bytes, 8) & 63) | 128);

  RETURN encode(out_bytes, 'hex')::uuid;
END;
$$;

CREATE TABLE IF NOT EXISTS envios (
  id                         UUID PRIMARY KEY DEFAULT uuid_v7(),
  origen                     TEXT NOT NULL,
  destino                    TEXT NOT NULL,
  lat_origen                 NUMERIC(10, 7),
  lon_origen                 NUMERIC(10, 7),
  lat_destino                NUMERIC(10, 7),
  lon_destino                NUMERIC(10, 7),
  estado                     TEXT NOT NULL DEFAULT 'PENDIENTE'
                             CHECK (estado IN ('PENDIENTE', 'ASIGNADO', 'EN_CAMINO', 'ENTREGADO', 'NO_ENTREGADO', 'CANCELADO')),
  cliente                    TEXT NOT NULL,   -- preferred_username de Keycloak del cliente
  mensajero                  TEXT,            -- TODO: Cambiar por cadete?
  operador_asignador         TEXT,            -- preferred_username del operador que realizó la asignación
  consultas_mapas_realizadas SMALLINT NOT NULL DEFAULT 0 CHECK (consultas_mapas_realizadas <= 5), -- Control cuota NFR-3
  fecha_creacion             TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_asignacion           TIMESTAMPTZ,
  fecha_entrega              TIMESTAMPTZ,
  actualizado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para optimizar búsquedas por rol (NFR-1 / NFR-6)
CREATE INDEX IF NOT EXISTS idx_envios_cliente   ON envios (cliente);
CREATE INDEX IF NOT EXISTS idx_envios_mensajero ON envios (mensajero);
CREATE INDEX IF NOT EXISTS idx_envios_estado    ON envios (estado);

-- Tabla de Auditoría e Historial de Estados (Trazabilidad e Idempotencia NFR-7)
CREATE TABLE IF NOT EXISTS historial_estados_envio (
  id              BIGSERIAL PRIMARY KEY,
  envio_id        UUID NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo    TEXT NOT NULL,
  cambiado_por    TEXT NOT NULL,
  motivo          TEXT,
  registrado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historial_envio_id ON historial_estados_envio(envio_id);

-- Datos iniciales compatibles con las identidades de Keycloak (realm-export.json)
-- IDs fijos UUID v7 para que la demo y los ejemplos del README sean reproducibles.
INSERT INTO envios (id, origen, destino, lat_origen, lon_origen, lat_destino, lon_destino, estado, cliente, mensajero, operador_asignador, consultas_mapas_realizadas, fecha_asignacion) VALUES
  ('01a1a901-5800-7000-8000-000000000001', 'Av. Corrientes 1000, CABA', 'Av. Cabildo 2000, CABA', -34.6037, -58.3816, -34.5614, -58.4563, 'PENDIENTE', 'cliente.demo', NULL, NULL, 2, NULL),
  ('01a1a901-5800-7000-8000-000000000002', 'Av. Rivadavia 5000, CABA',  'Calle Mitre 300, Avellaneda', -34.6186, -58.4357, -34.6625, -58.3650, 'EN_CAMINO', 'cliente.demo', 'cadete.demo', 'operador.demo', 4, now() - interval '20 minutes'),
  ('01a1a901-5800-7000-8000-000000000003', 'Av. Santa Fe 2500, CABA',   'Av. Maipú 1500, Vicente López', -34.5936, -58.4042, -34.5292, -58.4778, 'ENTREGADO', 'cliente.demo', 'cadete.demo', 'operador.demo', 4, now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;

INSERT INTO historial_estados_envio (envio_id, estado_anterior, estado_nuevo, cambiado_por, motivo)
SELECT id, NULL, 'PENDIENTE', cliente, 'Envío registrado en plataforma'
FROM envios WHERE id = '01a1a901-5800-7000-8000-000000000001'
ON CONFLICT DO NOTHING;
