import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { ESTADO_LABEL, claseEstado, fecha } from '../format.js';

export default function DetalleModal({ envioId, onCerrar }) {
  const [envio, setEnvio] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelado = false;
    setEnvio(null);
    setError(null);

    api(`/envios/${envioId}`)
      .then((data) => {
        if (!cancelado) setEnvio(data);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message || 'No se pudo cargar el envío.');
      });

    return () => {
      cancelado = true;
    };
  }, [envioId]);

  return (
    <Modal
      titulo="Detalle del envío"
      subtitulo={envio ? `${envio.origen} → ${envio.destino}` : envioId}
      onCerrar={onCerrar}
    >
      {error && <div className="alerta alerta-error">{error}</div>}
      {!envio && !error && <div className="vacio">Cargando…</div>}

      {envio && (
        <>
          <div className="detalle-grid">
            <Dato etiqueta="ID" valor={<code>{envio.id}</code>} ancho />
            <Dato
              etiqueta="Estado"
              valor={<span className={claseEstado(envio.estado)}>{ESTADO_LABEL[envio.estado] ?? envio.estado}</span>}
            />
            <Dato etiqueta="Cliente" valor={envio.cliente} />
            <Dato etiqueta="Cadete" valor={envio.mensajero || 'Sin asignar'} />
            <Dato etiqueta="Operador" valor={envio.operador_asignador || '—'} />
            <Dato etiqueta="Consultas de mapas" valor={envio.consultas_mapas_realizadas} />
            <Dato etiqueta="Creado" valor={fecha(envio.fecha_creacion)} />
            <Dato etiqueta="Asignado" valor={fecha(envio.fecha_asignacion)} />
            <Dato etiqueta="Entregado" valor={fecha(envio.fecha_entrega)} />
            <Dato etiqueta="Actualizado" valor={fecha(envio.actualizado_en)} />
            <Dato etiqueta="Origen" valor={envio.origen} ancho />
            <Dato etiqueta="Destino" valor={envio.destino} ancho />
            {(envio.lat_origen || envio.lat_destino) && (
              <Dato
                etiqueta="Coordenadas"
                valor={`${envio.lat_origen ?? '—'}, ${envio.lon_origen ?? '—'} → ${envio.lat_destino ?? '—'}, ${envio.lon_destino ?? '—'}`}
                ancho
              />
            )}
          </div>

          <h3 className="subtitulo">Historial de estados</h3>
          {envio.historial?.length ? (
            <ol className="timeline">
              {envio.historial.map((evento) => (
                <li key={evento.id}>
                  <span className="timeline-dot" />
                  <div>
                    <div className="timeline-linea">
                      <span className="muted">{evento.estado_anterior || '—'}</span>
                      <span className="flecha">→</span>
                      <span className={claseEstado(evento.estado_nuevo)}>
                        {ESTADO_LABEL[evento.estado_nuevo] ?? evento.estado_nuevo}
                      </span>
                    </div>
                    <div className="timeline-meta">
                      {fecha(evento.registrado_en)} · {evento.cambiado_por}
                      {evento.motivo ? ` · ${evento.motivo}` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Sin eventos de historial.</p>
          )}
        </>
      )}
    </Modal>
  );
}

function Dato({ etiqueta, valor, ancho = false }) {
  return (
    <div className={ancho ? 'dato dato-ancho' : 'dato'}>
      <span>{etiqueta}</span>
      <div>{valor}</div>
    </div>
  );
}
