-- Corre automáticamente solo la PRIMERA vez que se crea el volumen pgdata.
-- Arquitectura de Software 1 - UNAHUR
-- Esquema de Persistencia Relacional: Microservicio de Envíos (Escenario 3B)

CREATE TABLE IF NOT EXISTS envios (
  id                         SERIAL PRIMARY KEY,
  numero_seguimiento         TEXT UNIQUE NOT NULL,
  origen                     TEXT NOT NULL,
  destino                    TEXT NOT NULL,
  lat_origen                 NUMERIC(10, 7),
  lon_origen                 NUMERIC(10, 7),
  lat_destino                NUMERIC(10, 7),
  lon_destino                NUMERIC(10, 7),
  estado                     TEXT NOT NULL DEFAULT 'PENDIENTE'
                             CHECK (estado IN ('PENDIENTE', 'ASIGNADO', 'EN_CAMINO', 'ENTREGADO', 'NO_ENTREGADO', 'CANCELADO')),
  cliente                    TEXT NOT NULL,   -- preferred_username de Keycloak del cliente
  mensajero                  TEXT,            -- preferred_username de Keycloak del cadete asignado (NULL hasta asignación)
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
  envio_id        INTEGER NOT NULL REFERENCES envios(id) ON DELETE CASCADE,
  estado_anterior TEXT,
  estado_nuevo    TEXT NOT NULL,
  cambiado_por    TEXT NOT NULL,
  motivo          TEXT,
  registrado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historial_envio_id ON historial_estados_envio(envio_id);

-- Datos iniciales compatibles con las identidades de Keycloak (realm-export.json)
INSERT INTO envios (numero_seguimiento, origen, destino, lat_origen, lon_origen, lat_destino, lon_destino, estado, cliente, mensajero, operador_asignador, consultas_mapas_realizadas, fecha_asignacion) VALUES
  ('ENV-2026-0001', 'Av. Corrientes 1000, CABA', 'Av. Cabildo 2000, CABA', -34.6037, -58.3816, -34.5614, -58.4563, 'PENDIENTE', 'cliente.demo', NULL, NULL, 2, NULL),
  ('ENV-2026-0002', 'Av. Rivadavia 5000, CABA',  'Calle Mitre 300, Avellaneda', -34.6186, -58.4357, -34.6625, -58.3650, 'EN_CAMINO', 'cliente.demo', 'cadete.demo', 'operador.demo', 4, now() - interval '20 minutes'),
  ('ENV-2026-0003', 'Av. Santa Fe 2500, CABA',   'Av. Maipú 1500, Vicente López', -34.5936, -58.4042, -34.5292, -58.4778, 'ENTREGADO', 'cliente.demo', 'cadete.demo', 'operador.demo', 4, now() - interval '1 hour')
ON CONFLICT (numero_seguimiento) DO NOTHING;

INSERT INTO historial_estados_envio (envio_id, estado_anterior, estado_nuevo, cambiado_por, motivo)
SELECT id, NULL, 'PENDIENTE', cliente, 'Envío registrado en plataforma'
FROM envios WHERE numero_seguimiento = 'ENV-2026-0001'
ON CONFLICT DO NOTHING;
