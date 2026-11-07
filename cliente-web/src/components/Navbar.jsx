import React from 'react';
import { Package, LogOut, User } from 'lucide-react';

export default function Navbar({ usuario, onLogout }) {
  return (
    <header style={{ background: '#ffffff', borderBottom: '1px solid var(--border-color)', padding: '0.875rem 0' }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ background: '#eff6ff', color: 'var(--primary)', padding: '0.5rem', borderRadius: '0.5rem', display: 'flex' }}>
            <Package size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.2 }}>
              Motomensajería
            </h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Portal Web del Cliente</p>
          </div>
        </div>

        {usuario && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'right' }}>
              <User size={18} color="var(--text-muted)" />
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>{usuario.username}</p>
                <span className="badge badge-asignado" style={{ fontSize: '0.65rem' }}>
                  {usuario.roles?.includes('cliente') ? 'Cliente' : usuario.roles?.[0] || 'Usuario'}
                </span>
              </div>
            </div>
            <button onClick={onLogout} className="btn btn-outline" style={{ padding: '0.45rem 0.85rem' }} title="Cerrar sesión">
              <LogOut size={16} />
              <span>Salir</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
