import React from 'react';

const TRACKING_URL = (import.meta.env.VITE_TRACKING_URL || 'http://localhost:3002').replace(/\/+$/, '');

export default function MapaEnvio({ envioId, onVolver }) {
  const url = `${TRACKING_URL}/cliente.html?envio=${encodeURIComponent(envioId)}`;

  return (
    <section className="card mapa-envio">
      <div className="mapa-envio-header">
        <div>
          <h2>Seguimiento del envío</h2>
          <p>{envioId}</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onVolver}>
          Volver a mis envíos
        </button>
      </div>
      <iframe
        className="mapa-envio-frame"
        title={`Mapa de seguimiento del envío ${envioId}`}
        src={url}
      />
    </section>
  );
}
