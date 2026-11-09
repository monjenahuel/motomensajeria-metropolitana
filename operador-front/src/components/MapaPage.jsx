import { useEffect, useState } from 'react';
import { API_URL } from '../config.js';
import { accessToken } from '../session.js';

export default function MapaPage({ envioId, onVerTodos }) {
  const [listo, setListo] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let activo = true;
    const renovar = async () => {
      try {
        const token = await accessToken();
        const res = await fetch(`${API_URL}/mapas/sesion`, {
          method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('No se pudo autorizar el mapa.');
        if (activo) { setListo(true); setError(''); }
      } catch (err) {
        if (activo) { setListo(false); setError(err.message); }
      }
    };
    setListo(false);
    void renovar();
    const intervalo = setInterval(renovar, 240_000);
    return () => { activo = false; clearInterval(intervalo); };
  }, [envioId]);
  const url = envioId
    ? `${API_URL}/mapas/cliente.html?envio=${encodeURIComponent(envioId)}`
    : `${API_URL}/mapas/`;

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
          {listo && <a className="btn btn-ghost" href={url} target="_blank" rel="noopener noreferrer">
            Abrir en pestaña ↗
          </a>}
        </div>
      </div>

      <div className="mapa-frame-wrap">
        {error && <p role="alert">{error}</p>}
        {listo && <iframe
          className="mapa-frame"
          title={envioId ? `Seguimiento del envío ${envioId}` : 'Panel de tracking en vivo'}
          src={url}
        />}
      </div>

      <p className="panel-foot">
        Si el mapa no carga, verificá que el contenedor <code>tracking</code> esté levantado.
      </p>
    </section>
  );
}
