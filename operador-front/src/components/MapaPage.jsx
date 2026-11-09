import { TRACKING_URL } from '../config.js';

export default function MapaPage({ envioId, onVerTodos }) {
  const url = envioId
    ? `${TRACKING_URL}/cliente.html?envio=${encodeURIComponent(envioId)}`
    : TRACKING_URL;

  return (
    <section className="mapa-panel">
      <div className="panel-head">
        <div>
          <h2>{envioId ? 'Seguimiento del envío' : 'Mapa en vivo'}</h2>
          {envioId ? (
            <p>Envío <code>{envioId}</code>. Si no tiene cadete asignado, el mapa lo indicará.</p>
          ) : (
            <p>Posiciones de los cadetes en tiempo real (SSE) y métricas del microservicio de Tracking.</p>
          )}
        </div>
        <div className="panel-tools">
          {envioId && <button type="button" className="btn btn-ghost" onClick={onVerTodos}>Ver todos los cadetes</button>}
          <a className="btn btn-ghost" href={url} target="_blank" rel="noopener noreferrer">
            Abrir en pestaña ↗
          </a>
        </div>
      </div>

      <div className="mapa-frame-wrap">
        <iframe
          className="mapa-frame"
          title={envioId ? `Seguimiento del envío ${envioId}` : 'Panel de tracking en vivo'}
          src={url}
        />
      </div>

      <p className="panel-foot">
        Si el mapa no carga, verificá que el contenedor <code>tracking</code> esté levantado y que
        <code> VITE_TRACKING_URL</code> apunte al puerto correcto.
      </p>
    </section>
  );
}
