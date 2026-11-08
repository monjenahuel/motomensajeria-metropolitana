import { useEffect } from 'react';

export default function Modal({ titulo, subtitulo, onCerrar, children }) {
  useEffect(() => {
    function alPresionar(evento) {
      if (evento.key === 'Escape') onCerrar();
    }
    document.addEventListener('keydown', alPresionar);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', alPresionar);
      document.body.style.overflow = '';
    };
  }, [onCerrar]);

  return (
    <div
      className="overlay"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) onCerrar();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-head">
          <div>
            <h2>{titulo}</h2>
            {subtitulo && <p>{subtitulo}</p>}
          </div>
          <button type="button" className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
