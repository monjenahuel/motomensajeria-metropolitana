import React, { useEffect, useState } from 'react';
import { abrirSesionMapa, MAPAS_URL } from '../services/api';
import { idCorto } from '../format';

export default function MapaEnvio({ envioId, token, onVolver }) {
  const [listo, setListo] = useState(false);
  const [error, setError] = useState('');
  const url = `${MAPAS_URL}/cliente.html?envio=${encodeURIComponent(envioId)}`;

  useEffect(() => {
    let activo = true;
    const renovar = () => abrirSesionMapa(token)
      .then(() => { if (activo) { setListo(true); setError(''); } })
      .catch((err) => { if (activo) { setListo(false); setError(err.message); } });
    setListo(false);
    void renovar();
    const intervalo = setInterval(renovar, 240_000);
    return () => { activo = false; clearInterval(intervalo); };
  }, [token, envioId]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Seguimiento del envío · {idCorto(envioId)}</h2>
          <p title={envioId}>Ubicación en vivo vía SSE y cookie HttpOnly autorizada en el Gateway.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onVolver}>
          Volver a mis envíos
        </button>
      </div>
      {error && <div className="panel-body"><div className="alerta alerta-error" role="alert">{error}</div></div>}
      {listo && (
        <iframe
          className="mapa-envio-frame"
          title={`Mapa de seguimiento del envío ${envioId}`}
          src={url}
        />
      )}
    </section>
  );
}
