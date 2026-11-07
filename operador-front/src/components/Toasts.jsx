export default function Toasts({ toasts, onCerrar }) {
  if (!toasts.length) return null;

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.tipo}`}
          onClick={() => onCerrar(toast.id)}
          role="status"
        >
          <span className="toast-icono">{toast.tipo === 'ok' ? '✓' : '!'}</span>
          <p>{toast.mensaje}</p>
          <button type="button" className="toast-cerrar" aria-label="Cerrar notificación">×</button>
        </div>
      ))}
    </div>
  );
}
