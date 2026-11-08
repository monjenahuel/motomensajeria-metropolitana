import React from 'react';
import { Package, RefreshCw, Eye, UserCheck, Calendar } from 'lucide-react';

export default function ListaEnvios({ envios, loading, onRefresh, onVerDetalle }) {
  const getBadgeClass = (estado) => {
    switch (estado) {
      case 'PENDIENTE': return 'badge-pendiente';
      case 'ASIGNADO': return 'badge-asignado';
      case 'EN_CAMINO': return 'badge-en-camino';
      case 'ENTREGADO': return 'badge-entregado';
      default: return 'badge-pendiente';
    }
  };

  const formatearFecha = (fechaStr) => {
    if (!fechaStr) return '-';
    const d = new Date(fechaStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Package size={20} color="var(--primary)" />
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Mis Envíos</h2>
          <span style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '0.15rem 0.5rem', borderRadius: '9999px', fontWeight: 600 }}>
            {envios.length}
          </span>
        </div>

        <button
          onClick={onRefresh}
          className="btn btn-outline"
          disabled={loading}
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.825rem' }}
          title="Actualizar lista de envíos"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refrescar</span>
        </button>
      </div>

      {envios.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
          <Package size={40} strokeWidth={1.5} style={{ margin: '0 auto 0.75rem auto', opacity: 0.5 }} />
          <p style={{ fontWeight: 500 }}>No tenés envíos registrados aún.</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Creá tu primer pedido usando el formulario de arriba.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Seguimiento</th>
                <th>Origen</th>
                <th>Destino</th>
                <th>Estado</th>
                <th>Cadete Asignado</th>
                <th>Creación</th>
                <th style={{ textAlign: 'right' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {envios.map((envio) => (
                <tr key={envio.id}>
                  <td>
                    <span style={{ fontWeight: 600, fontFamily: 'monospace', color: 'var(--primary)' }}>
                      {envio.numero_seguimiento}
                    </span>
                  </td>
                  <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {envio.origen}
                  </td>
                  <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {envio.destino}
                  </td>
                  <td>
                    <span className={`badge ${getBadgeClass(envio.estado)}`}>
                      {envio.estado}
                    </span>
                  </td>
                  <td>
                    {envio.mensajero ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-main)', fontSize: '0.85rem' }}>
                        <UserCheck size={14} color="#16a34a" />
                        <strong>{envio.mensajero}</strong>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                        Sin asignar
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {formatearFecha(envio.fecha_creacion)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-outline"
                      onClick={() => onVerDetalle(envio.id)}
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                      title="Ver trazabilidad e historial"
                    >
                      <Eye size={14} />
                      <span>Detalle</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
