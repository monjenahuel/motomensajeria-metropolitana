import React, { useState } from 'react';
import { PlusCircle, MapPin, Send, AlertCircle, CheckCircle2 } from 'lucide-react';

const PRESETS = [
  { origen: 'Av. Corrientes 1200, CABA', destino: 'Av. Cabildo 2200, CABA', lat_origen: -34.6037, lon_origen: -58.3816, lat_destino: -34.5614, lon_destino: -58.4563 },
  { origen: 'Av. Santa Fe 3000, CABA', destino: 'Calle Mitre 450, Avellaneda', lat_origen: -34.5936, lon_origen: -58.4042, lat_destino: -34.6625, lon_destino: -58.3650 },
  { origen: 'Av. Rivadavia 6500, Flores', destino: 'Av. Maipú 1200, Vicente López', lat_origen: -34.6186, lon_origen: -58.4357, lat_destino: -34.5292, lon_destino: -58.4778 },
  { origen: 'Av. La Plata 500, Caballito', destino: 'Av. San Martín 2000, Morón', lat_origen: -34.6200, lon_origen: -58.4300, lat_destino: -34.6500, lon_destino: -58.6200 },
];

export default function CrearEnvioForm({ onCrear, onCancel }) {
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [coordenadas, setCoordenadas] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!origen.trim() || !destino.trim()) {
      setError('Por favor complete las direcciones de origen y destino');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const payload = {
        origen: origen.trim(),
        destino: destino.trim(),
        ...(coordenadas || {}),
      };
      await onCrear(payload);
      setExito(true);
      setTimeout(() => {
        setExito(false);
        setOrigen('');
        setDestino('');
        setCoordenadas(null);
      }, 1500);
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
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <PlusCircle size={20} color="var(--primary)" />
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Solicitar Nuevo Envío</h2>
        </div>
        {onCancel && (
          <button type="button" className="btn btn-outline" onClick={onCancel} style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
            Cerrar
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', fontSize: '0.85rem' }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {exito && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', fontSize: '0.85rem' }}>
          <CheckCircle2 size={18} />
          <span>¡Envío creado exitosamente y evento publicado en RabbitMQ!</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <MapPin size={15} color="var(--primary)" />
              <span>Dirección de Origen (Retiro)</span>
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Ej: Av. Corrientes 1000, CABA"
              value={origen}
              onChange={(e) => setOrigen(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              <MapPin size={15} color="#dc2626" />
              <span>Dirección de Destino (Entrega)</span>
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Ej: Av. Cabildo 2000, CABA"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              required
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cargar ruta rápida:</span>
            {PRESETS.map((p, idx) => (
              <button
                key={idx}
                type="button"
                className="btn btn-outline"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                onClick={() => aplicarPreset(p)}
              >
                Ruta #{idx + 1}
              </button>
            ))}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ padding: '0.65rem 1.25rem' }}
          >
            <Send size={16} />
            <span>{loading ? 'Creando...' : 'Crear Pedido'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
