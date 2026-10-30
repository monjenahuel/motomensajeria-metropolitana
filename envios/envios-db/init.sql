-- Corre automáticamente solo la PRIMERA vez que se crea el volumen pgdata.

CREATE TABLE IF NOT EXISTS envios (
  id         SERIAL      PRIMARY KEY,
  origen     TEXT        NOT NULL,
  destino    TEXT        NOT NULL,
  estado     TEXT        NOT NULL DEFAULT 'PENDIENTE'
             CHECK (estado IN ('PENDIENTE', 'ASIGNADO', 'EN_CAMINO', 'ENTREGADO')),
  cliente    TEXT        NOT NULL,   -- username (preferred_username) del cliente que creó el envío
  mensajero  TEXT,                   -- username del mensajero asignado; NULL hasta que se asigna
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los clientes ven solo sus envíos y los mensajeros solo los asignados: se filtra por estas columnas.
CREATE INDEX IF NOT EXISTS idx_envios_cliente   ON envios (cliente);
CREATE INDEX IF NOT EXISTS idx_envios_mensajero ON envios (mensajero);

INSERT INTO envios (origen, destino, estado, cliente, mensajero) VALUES
  ('Av. Corrientes 1000, CABA', 'Av. Cabildo 2000, CABA',          'PENDIENTE', 'cliente.demo', NULL),
  ('Av. Rivadavia 5000, CABA',  'Calle Mitre 300, Avellaneda',      'EN_CAMINO', 'cliente.demo', 'mensajero.demo'),
  ('Av. Santa Fe 2500, CABA',   'Av. Maipú 1500, Vicente López',    'ENTREGADO', 'cliente.demo', 'mensajero.demo');