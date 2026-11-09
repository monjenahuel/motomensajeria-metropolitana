import { useMemo, useState } from 'react';
import { ESTADOS, ESTADO_LABEL, claseEstado, fecha, hora, idCorto, esFinal, esVigente } from '../format.js';

export default function AsignacionesPage({
  asignaciones,
  cargando,
  actualizado,
  auto,
  onAuto,
  onRefrescar,
  onLiberar,
  onDetalle,
  onSeguimiento,
}) {
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('TODOS');

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return asignaciones.filter((envio) => {
      if (estado !== 'TODOS' && envio.estado !== estado) return false;
      if (!q) return true;
      return [envio.id, envio.origen, envio.destino, envio.cliente, envio.mensajero, envio.operador_asignador]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [asignaciones, busqueda, estado]);

  const stats = useMemo(() => ({
    vigentes: asignaciones.filter((e) => esVigente(e.estado)).length,
    asignadas: asignaciones.filter((e) => e.estado === 'ASIGNADO').length,
    enCamino: asignaciones.filter((e) => e.estado === 'EN_CAMINO').length,
    finalizadas: asignaciones.filter((e) => esFinal(e.estado)).length,
  }), [asignaciones]);

  return (
    <section>
      <div className="stats">
        <Tarjeta etiqueta="Vigentes" valor={stats.vigentes} tono="asignado" />
        <Tarjeta etiqueta="Asignadas" valor={stats.asignadas} />
        <Tarjeta etiqueta="En camino" valor={stats.enCamino} tono="camino" />
        <Tarjeta etiqueta="Finalizadas" valor={stats.finalizadas} tono="finalizado" />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Asignaciones</h2>
            <p>Envíos con cadete asignado. La fuente de verdad es PostgreSQL en el MS de Envíos.</p>
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
            placeholder="Buscar por ID, recorrido, cliente o cadete…"
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
                <th>Cadete</th>
                <th>Estado</th>
                <th>Asignado</th>
                <th>Operador</th>
                <th className="acciones-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((envio) => (
                <tr key={envio.id}>
                  <td>
                    <button type="button" className="link-id" title={`Seguir envío ${envio.id} en el mapa`} onClick={() => onSeguimiento(envio.id)}>
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
                  <td><span className="cadete">{envio.mensajero}</span></td>
                  <td><span className={claseEstado(envio.estado)}>{ESTADO_LABEL[envio.estado] ?? envio.estado}</span></td>
                  <td className="muted">{fecha(envio.fecha_asignacion)}</td>
                  <td>{envio.operador_asignador || '—'}</td>
                  <td className="acciones">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => onDetalle(envio.id)}>
                      Ver
                    </button>
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

        {cargando && !asignaciones.length && <div className="vacio">Cargando asignaciones…</div>}
        {!cargando && !filtradas.length && <div className="vacio">No hay asignaciones que coincidan con el filtro.</div>}

        <div className="panel-foot">
          Se incluyen los envíos finalizados como historial. Solo se pueden liberar los que están en estado
          <code> ASIGNADO</code>.
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
