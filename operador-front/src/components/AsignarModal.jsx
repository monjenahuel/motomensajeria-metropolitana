import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { TRACKING_URL } from '../config.js';

const SUGERENCIAS_BASE = ['cadete.demo'];

export default function AsignarModal({ envio, onCerrar, onAsignar }) {
  const [mensajero, setMensajero] = useState('');
  const [sugerencias, setSugerencias] = useState(SUGERENCIAS_BASE);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  // Sugerencias: cadetes que están reportando posiciones + el usuario de demo.
  useEffect(() => {
    let cancelado = false;
    fetch(`${TRACKING_URL}/tracking/cadetes`)
      .then((respuesta) => (respuesta.ok ? respuesta.json() : []))
      .then((lista) => {
        if (cancelado || !Array.isArray(lista)) return;
        const ids = lista.map((posicion) => posicion.cadeteId).filter(Boolean);
        setSugerencias([...new Set([...SUGERENCIAS_BASE, ...ids])]);
      })
      .catch(() => {
        // Si Tracking no está disponible, se puede escribir el username a mano.
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function onSubmit(evento) {
    evento.preventDefault();
    const valor = mensajero.trim();
    if (!valor) {
      setError('Ingresá el username del cadete.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await onAsignar(envio, valor);
    } catch (err) {
      setError(err.message || 'No se pudo asignar el envío.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo="Asignar envío"
      subtitulo={`${envio.origen} → ${envio.destino}`}
      onCerrar={onCerrar}
    >
      <div className="resumen">
        <div><span>Envío</span><code>{envio.id}</code></div>
        <div><span>Cliente</span><strong>{envio.cliente}</strong></div>
        <div><span>Estado</span><strong>{envio.estado}</strong></div>
      </div>

      <form className="form" onSubmit={onSubmit}>
        <label>
          Username del cadete
          <input
            className="input"
            list="cadetes-sugeridos"
            placeholder="cadete.demo"
            value={mensajero}
            onChange={(e) => setMensajero(e.target.value)}
            autoFocus
          />
        </label>
        <datalist id="cadetes-sugeridos">
          {sugerencias.map((cadete) => <option key={cadete} value={cadete} />)}
        </datalist>

        <p className="hint">
          Sugerencias: cadetes reportando posiciones ahora mismo y <code>cadete.demo</code>.
          Podés escribir cualquier username de Keycloak con rol <code>cadete</code>.
        </p>

        {error && <div className="alerta alerta-error">{error}</div>}

        <div className="modal-acciones">
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={enviando}>
            {enviando ? 'Asignando…' : 'Asignar envío'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
