-- Proyección local de Tracking. Envíos sigue siendo la fuente de verdad.
CREATE TABLE IF NOT EXISTS asignaciones (
  envio_id UUID PRIMARY KEY,
  cadete_id TEXT NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_asignaciones_cadete ON asignaciones (cadete_id);

-- Inbox: el ACK a RabbitMQ se envía después del COMMIT; las redeliveries son idempotentes.
CREATE TABLE IF NOT EXISTS eventos_procesados (
  event_id UUID PRIMARY KEY,
  procesado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
