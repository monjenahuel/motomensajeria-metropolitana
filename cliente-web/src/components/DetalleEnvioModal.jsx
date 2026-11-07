import React from 'react';
import { X, CheckCircle, Clock, MapPin, User, ShieldCheck } from 'lucide-react';

export default function DetalleEnvioModal({ envio, onClose }) {
  if (!envio) return null;

  const formatearFecha = (fechaStr) => {
    if (!fechaStr) return '-';
    const d = new Date(fechaStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · ' + d.toLocaleDateString();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Detalle de Envío</span>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--primary)' }}>
              {envio.numero_seguimiento}
            </h3>
          </div>
          <button onClick={onClose} className="btn btn-outline" style={{ padding: '0.35rem', borderRadius: '50%' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Estado Actual:</span>
              <span className={`badge badge-${envio.estado.toLowerCase()}`}>
                {envio.estado}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Cadete Asignado:</span>
              <strong>{envio.mensajero || 'Sin asignar'}</strong>
            </div>
            {envio.operador_asignador && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Operador:</span>
                <span>{envio.operador_asignador}</span>
              </div>
            )}
          </div>

          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
              Ruta del Pedido
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <MapPin size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Origen / Retiro</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{envio.origen}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <MapPin size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Destino / Entrega</p>
                  <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{envio.destino}</p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <ShieldCheck size={16} color="var(--primary)" />
              <span>Historial de Auditoría y Trazabilidad (NFR-7)</span>
            </h4>

            {envio.historial && envio.historial.length > 0 ? (
              <div style={{ borderLeft: '2px solid var(--border-color)', marginLeft: '0.5rem', paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {envio.historial.map((item, idx) => (
                  <div key={idx} style={{ position: 'relative' }}>
                    <div style={{
                      position: 'absolute',
                      left: '-1.35rem',
                      top: '0.2rem',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--primary)',
                      border: '2px solid #ffffff'
                    }} />
                    <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                      Transición a <span style={{ color: 'var(--primary)' }}>{item.estado_nuevo}</span>
                    </p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Por: <strong>{item.cambiado_por}</strong> · {formatearFecha(item.registrado_en)}
                    </p>
                    {item.motivo && (
                      <p style={{ fontSize: '0.75rem', fontStyle: 'italic', color: '#475569', marginTop: '0.15rem' }}>
                        "{item.motivo}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Aún no registra transiciones en auditoría.
              </p>
            )}
          </div>
        </div>

        <button onClick={onClose} className="btn btn-outline" style={{ width: '100%' }}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
