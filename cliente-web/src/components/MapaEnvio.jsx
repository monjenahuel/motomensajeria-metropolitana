import React, { useEffect, useState } from 'react';
import { abrirSesionMapa, MAPAS_URL } from '../services/api';

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
      {error && <p role="alert">{error}</p>}
      {listo && <iframe
        className="mapa-envio-frame"
        title={`Mapa de seguimiento del envío ${envioId}`}
        src={url}
      />}
    </section>
  );
}
