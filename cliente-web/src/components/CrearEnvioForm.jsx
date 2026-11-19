import React, { useState } from 'react';

const PRESETS = [
  { label: 'Corrientes → Cabildo', origen: 'Av. Corrientes 1200, CABA', destino: 'Av. Cabildo 2200, CABA', lat_origen: -34.6037, lon_origen: -58.3816, lat_destino: -34.5614, lon_destino: -58.4563 },
  { label: 'Santa Fe → Avellaneda', origen: 'Av. Santa Fe 3000, CABA', destino: 'Calle Mitre 450, Avellaneda', lat_origen: -34.5936, lon_origen: -58.4042, lat_destino: -34.6625, lon_destino: -58.3650 },
  { label: 'Flores → Vicente López', origen: 'Av. Rivadavia 6500, Flores', destino: 'Av. Maipú 1200, Vicente López', lat_origen: -34.6186, lon_origen: -58.4357, lat_destino: -34.5292, lon_destino: -58.4778 },
  { label: 'Caballito → Morón', origen: 'Av. La Plata 500, Caballito', destino: 'Av. San Martín 2000, Morón', lat_origen: -34.6200, lon_origen: -58.4300, lat_destino: -34.6500, lon_destino: -58.6200 },
];

export default function CrearEnvioForm({ onCrear }) {
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [coordenadas, setCoordenadas] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!origen.trim() || !destino.trim()) {
      setError('Completá las direcciones de origen y destino.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onCrear({
        origen: origen.trim(),
        destino: destino.trim(),
        ...(coordenadas || {}),
      });
      setExito(true);
      setOrigen('');
      setDestino('');
      setCoordenadas(null);
      setTimeout(() => setExito(false), 2500);
    } catch (err) {
      setError(err.message || 'Error al solicitar el envío');
    } finally {
      setLoading(false);
    }
  };

  const aplicarPreset = (p) => {
    setOrigen(p.origen);
    setDestino(p.destino);
    setCoordenadas({
      lat_origen: p.lat_origen,
      lon_origen: p.lon_origen,
      lat_destino: p.lat_destino,
      lon_destino: p.lon_destino,
    });
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Solicitar nuevo envío</h2>
          <p>Registrá un retiro y entrega; el evento se publica en RabbitMQ para geocodificación y asignación.</p>
        </div>
      </div>

      <div className="panel-body">
        <form className="form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              Dirección de origen (retiro)
              <input
                className="input"
                type="text"
                value={origen}
                onChange={(e) => { setOrigen(e.target.value); setCoordenadas(null); }}
                placeholder="Ej. Av. Corrientes 1200, CABA"
                disabled={loading}
              />
            </label>
            <label>
              Dirección de destino (entrega)
              <input
                className="input"
                type="text"
                value={destino}
                onChange={(e) => { setDestino(e.target.value); setCoordenadas(null); }}
                placeholder="Ej. Av. Cabildo 2200, CABA"
                disabled={loading}
              />
            </label>
          </div>

          <div className="presets">
            <span className="presets-label">Rutas rápidas:</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => aplicarPreset(p)}
                disabled={loading}
              >
                {p.label}
              </button>
            ))}
          </div>

          {error && <div className="alerta alerta-error" role="alert">{error}</div>}
          {exito && <div className="alerta alerta-ok" role="status">Pedido registrado y evento emitido correctamente.</div>}

          <div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Enviando solicitud…' : 'Crear envío'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
