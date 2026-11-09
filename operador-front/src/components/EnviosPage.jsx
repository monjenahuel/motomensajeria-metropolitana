import { useMemo, useState } from 'react';
import { ESTADOS, ESTADO_LABEL, claseEstado, fecha, hora, idCorto } from '../format.js';

export default function EnviosPage({
  envios,
  cargando,
  actualizado,
  auto,
  onAuto,
  onRefrescar,
  onAsignar,
  onLiberar,
  onDetalle,
  onSeguimiento,
}) {
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('TODOS');

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return envios.filter((envio) => {
      if (estado !== 'TODOS' && envio.estado !== estado) return false;
      if (!q) return true;
      return [
        envio.id,
        envio.origen,
        envio.destino,
        envio.cliente,
        envio.mensajero,
        envio.operador_asignador,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [envios, busqueda, estado]);

  const stats = useMemo(() => ({
    total: envios.length,
    pendientes: envios.filter((e) => e.estado === 'PENDIENTE').length,
    asignados: envios.filter((e) => e.estado === 'ASIGNADO').length,
    enCamino: envios.filter((e) => e.estado === 'EN_CAMINO').length,
    finalizados: envios.filter((e) => ['ENTREGADO', 'NO_ENTREGADO', 'CANCELADO'].includes(e.estado)).length,
  }), [envios]);

  return (
    <section>
      <div className="stats">
        <Tarjeta etiqueta="Total" valor={stats.total} />
        <Tarjeta etiqueta="Pendientes" valor={stats.pendientes} tono="pendiente" />
        <Tarjeta etiqueta="Asignados" valor={stats.asignados} tono="asignado" />
        <Tarjeta etiqueta="En camino" valor={stats.enCamino} tono="camino" />
        <Tarjeta etiqueta="Finalizados" valor={stats.finalizados} tono="finalizado" />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Envíos</h2>
            <p>Asigná envíos pendientes, liberá asignaciones y consultá el historial.</p>
          </div>
          <div className="panel-tools">
            <span className="actualizado">{actualizado ? `Actualizado ${hora(actualizado)}` : '—'}</span>
            <label className="switch">
              <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
              <span>Auto 15 s</span>
            </label>
            <button type="button" className="btn btn-ghost" onClick={onRefrescar} disabled={cargando}>
              {cargando ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
        </div>

        <div className="filtros">
          <input
            className="input"
            type="search"
            placeholder="Buscar por ID, origen, destino, cliente o cadete…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <select className="input select" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="TODOS">Todos los estados</option>
            {ESTADOS.map((valor) => (
              <option key={valor} value={valor}>{ESTADO_LABEL[valor]}</option>
            ))}
          </select>
        </div>

        <div className="tabla-wrap">
          <table className="tabla">
            <thead>
              <tr>
                <th>Envío</th>
                <th>Recorrido</th>
                <th>Cliente</th>
                <th>Cadete</th>
                <th>Estado</th>
                <th>Actualizado</th>
                <th className="acciones-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((envio) => (
                <tr key={envio.id}>
                  <td>
                    <button
                      type="button"
                      className="link-id"
                      title={`Seguir envío ${envio.id} en el mapa`}
                      onClick={() => onSeguimiento(envio.id)}
                    >
                      {idCorto(envio.id)}
                    </button>
                  </td>
                  <td>
                    <div className="recorrido">
                      <span>{envio.origen}</span>
                      <span className="flecha">→</span>
                      <span>{envio.destino}</span>
                    </div>
                  </td>
                  <td>{envio.cliente || '—'}</td>
                  <td>
                    {envio.mensajero
                      ? <span className="cadete">{envio.mensajero}</span>
                      : <span className="muted">Sin asignar</span>}
                  </td>
                  <td>
                    <span className={claseEstado(envio.estado)}>{ESTADO_LABEL[envio.estado] ?? envio.estado}</span>
                  </td>
                  <td className="muted">{fecha(envio.actualizado_en)}</td>
                  <td className="acciones">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => onDetalle(envio.id)}>
                      Detalles
                    </button>
                    {envio.estado === 'PENDIENTE' && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => onAsignar(envio)}>
                        Asignar
                      </button>
                    )}
                    {envio.estado === 'ASIGNADO' && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => onLiberar(envio)}>
                        Liberar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {cargando && !envios.length && <div className="vacio">Cargando envíos…</div>}
        {!cargando && !filtrados.length && <div className="vacio">No hay envíos que coincidan con el filtro.</div>}

        <div className="panel-foot">
          Mostrando {filtrados.length} de {envios.length} envíos (máximo 100 por consulta).
        </div>
      </div>
    </section>
  );
}

function Tarjeta({ etiqueta, valor, tono = '' }) {
  return (
    <div className={`stat ${tono ? `stat-${tono}` : ''}`}>
      <span className="stat-valor">{valor}</span>
      <span className="stat-etiqueta">{etiqueta}</span>
    </div>
  );
}
