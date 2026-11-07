import { TRACKING_URL } from '../config.js';

export default function MapaPage() {
  return (
    <section className="mapa-panel">
      <div className="panel-head">
        <div>
          <h2>Mapa en vivo</h2>
          <p>
            Posiciones de los cadetes en tiempo real (SSE) y métricas del microservicio de Tracking.
            El panel se sirve desde <code>{TRACKING_URL}</code>.
          </p>
        </div>
        <a className="btn btn-ghost" href={TRACKING_URL} target="_blank" rel="noreferrer">
          Abrir en pestaña ↗
        </a>
      </div>

      <div className="mapa-frame-wrap">
        <iframe
          className="mapa-frame"
          title="Panel de tracking en vivo"
          src={TRACKING_URL}
        />
      </div>

      <p className="panel-foot">
        Si el mapa no carga, verificá que el contenedor <code>tracking</code> esté levantado y que
        <code> VITE_TRACKING_URL</code> apunte al puerto correcto.
      </p>
    </section>
  );
}
