import React from 'react';

export default function DetalleEnvioModal({ envio, onClose }) {
  if (!envio) return null;

  const formatearFecha = (fechaStr) => {
    if (!fechaStr) return '—';
    const d = new Date(fechaStr);
    return `${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${d.toLocaleDateString('es-AR')}`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>Detalle del envío</h2>
            <p>{envio.numero_seguimiento || envio.id}</p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Cerrar
          </button>
        </div>

        <div className="modal-body">
          <div className="detalle-resumen">
            <div>
              <span>Estado actual</span>
              <span className={`estado estado-${String(envio.estado).toLowerCase()}`}>
                {envio.estado}
              </span>
            </div>
            <div>
              <span>Cadete asignado</span>
              <strong>{envio.mensajero || 'Sin asignar'}</strong>
            </div>
            {envio.operador_asignador && (
              <div>
                <span>Operador</span>
                <strong>{envio.operador_asignador}</strong>
              </div>
            )}
            <div>
              <span>Origen</span>
              <strong>{envio.origen}</strong>
            </div>
            <div>
              <span>Destino</span>
              <strong>{envio.destino}</strong>
            </div>
          </div>

          <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>Historial de auditoría</h3>
          {envio.historial && envio.historial.length > 0 ? (
            <ul className="timeline">
              {envio.historial.map((h) => (
                <li key={h.id} className="timeline-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <strong>{h.estado_nuevo}</strong>
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{formatearFecha(h.fecha)}</span>
                  </div>
                  {h.motivo && <p style={{ margin: '4px 0 2px', fontSize: '13px' }}>{h.motivo}</p>}
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Actor: {h.actor || 'sistema'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="vacio" style={{ padding: '16px' }}>Sin historial disponible.</p>
          )}
        </div>
      </div>
    </div>
  );
}
