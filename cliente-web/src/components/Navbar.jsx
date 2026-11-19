import React from 'react';

export default function Navbar({ usuario, syncEstado, onLogout }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">MM</span>
        <div className="brand-text">
          <strong>MotoMensajería</strong>
          <span>Panel de Cliente</span>
        </div>
      </div>

      {usuario && (
        <div className="topbar-right">
          <span className={`sync-pill ${syncEstado === 'en-vivo' ? 'en-vivo' : ''}`}>
            <span className="sync-dot" aria-hidden="true" />
            {syncEstado === 'en-vivo' ? 'En vivo' : 'Conectando…'}
          </span>
          <strong>{usuario.username}</strong>
          <button type="button" onClick={onLogout} className="btn btn-ghost">
            Salir
          </button>
        </div>
      )}
    </header>
  );
}
