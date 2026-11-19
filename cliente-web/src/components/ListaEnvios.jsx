import React, { useMemo, useState } from 'react';
import { idCorto } from '../format';

const ESTADO_LABEL = {
  PENDIENTE: 'Pendiente',
  ASIGNADO: 'Asignado',
  EN_CAMINO: 'En camino',
  ENTREGADO: 'Entregado',
  NO_ENTREGADO: 'No entregado',
  CANCELADO: 'Cancelado',
};

export default function ListaEnvios({ envios, loading, syncEstado, onRefresh, onVerDetalle, onSeguimiento }) {
  const [busqueda, setBusqueda] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('TODOS');

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return envios.filter((e) => {
      if (estadoFiltro !== 'TODOS' && e.estado !== estadoFiltro) return false;
      if (!q) return true;
      return [e.id, e.origen, e.destino, e.mensajero, e.estado]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [envios, busqueda, estadoFiltro]);

  const formatearFecha = (fechaStr) => {
    if (!fechaStr) return '—';
    const d = new Date(fechaStr);
    return `${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · ${d.toLocaleDateString('es-AR')}`;
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Mis envíos</h2>
          <p>
            {syncEstado === 'en-vivo'
              ? 'Sincronizado en tiempo real con eventos del broker.'
              : 'Conectando al stream de eventos…'}
            {' '}Hacé clic en el ID cuando el envío esté en camino para ver el mapa en vivo.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      <div className="filtros">
        <input
          className="input"
          type="search"
          aria-label="Buscar envíos"
          placeholder="Buscar por ID, origen, destino o cadete"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select
          className="input"
          aria-label="Filtrar por estado"
          value={estadoFiltro}
          onChange={(e) => setEstadoFiltro(e.target.value)}
          style={{ width: 'auto', minWidth: '180px' }}
        >
          <option value="TODOS">Todos los estados</option>
          {Object.entries(ESTADO_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {!filtrados.length ? (
        <p className="vacio">
          {envios.length === 0
            ? 'No tenés envíos registrados aún. Creá tu primer pedido arriba.'
            : 'No hay envíos que coincidan con el filtro.'}
        </p>
      ) : (
        <div className="tabla-wrap">
          <table className="tabla">
            <thead>
              <tr>
                <th>ID</th>
                <th>Origen</th>
                <th>Destino</th>
                <th>Estado</th>
                <th>Cadete</th>
                <th>Creación</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((envio) => (
                <tr key={envio.id}>
                  <td>
                    {envio.estado === 'EN_CAMINO' ? (
                      <button
                        type="button"
                        className="seguimiento-link"
                        onClick={() => onSeguimiento(envio.id)}
                        title={`Ver seguimiento del envío ${envio.id} en el mapa`}
                      >
                        {idCorto(envio.id)}
                      </button>
                    ) : (
                      <code title={`${envio.id} · El mapa se habilita cuando el envío está en camino`}>
                        {idCorto(envio.id)}
                      </code>
                    )}
                  </td>
                  <td>{envio.origen}</td>
                  <td>{envio.destino}</td>
                  <td>
                    <span className={`estado estado-${String(envio.estado).toLowerCase()}`}>
                      {ESTADO_LABEL[envio.estado] || envio.estado}
                    </span>
                  </td>
                  <td>{envio.mensajero || 'Sin asignar'}</td>
                  <td>{formatearFecha(envio.creado_en)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="panel-tools" style={{ justifyContent: 'flex-end' }}>
                      {envio.estado === 'EN_CAMINO' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => onSeguimiento(envio.id)}
                        >
                          Ver mapa
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onVerDetalle(envio.id)}
                      >
                        Detalle
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
