import { useState } from 'react';
import Modal from './Modal.jsx';
import { idCorto } from '../format.js';

export default function LiberarModal({ envio, onCerrar, onConfirmar }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  async function confirmar() {
    setEnviando(true);
    setError(null);
    try {
      await onConfirmar(envio);
    } catch (err) {
      setError(err.message || 'No se pudo liberar la asignación.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo="Liberar asignación"
      subtitulo={`Envío ${idCorto(envio.id)}`}
      onCerrar={onCerrar}
    >
      <p>
        El envío volverá al estado <strong>PENDIENTE</strong> y se quitará el cadete
        <strong> {envio.mensajero}</strong>.
      </p>
      <p className="hint">
        Solo se pueden liberar asignaciones en estado <code>ASIGNADO</code>.
        Si el cadete ya inició el recorrido, el servidor responderá 409.
      </p>

      {error && <div className="alerta alerta-error">{error}</div>}

      <div className="modal-acciones">
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={enviando}>
          Cancelar
        </button>
        <button type="button" className="btn btn-danger" onClick={confirmar} disabled={enviando}>
          {enviando ? 'Liberando…' : 'Liberar asignación'}
        </button>
      </div>
    </Modal>
  );
}
