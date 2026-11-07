import React, { useState } from 'react';
import { LogIn, KeyRound, AlertCircle } from 'lucide-react';

export default function LoginForm({ onLoginSuccess }) {
  const [username, setUsername] = useState('cliente.demo');
  const [password, setPassword] = useState('cliente123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onLoginSuccess(username, password);
    } catch (err) {
      setError(err.message || 'Error al autenticarse contra el API Gateway');
    } finally {
      setLoading(false);
    }
  };

  const setCredencialesRapidas = (u, p) => {
    setUsername(u);
    setPassword(p);
  };

  return (
    <div style={{ maxWidth: '420px', margin: '4rem auto 0 auto' }}>
      <div className="card" style={{ padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{
            display: 'inline-flex',
            padding: '0.75rem',
            background: '#eff6ff',
            color: 'var(--primary)',
            borderRadius: '50%',
            marginBottom: '0.75rem'
          }}>
            <KeyRound size={28} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Iniciar Sesión</h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Autenticación OIDC centralizada vía API Gateway
          </p>
        </div>

        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.75rem',
            borderRadius: '0.5rem',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1rem'
          }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              Usuario (Keycloak)
            </label>
            <input
              type="text"
              className="input-field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ej: cliente.demo"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              Contraseña
            </label>
            <input
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem' }}
            disabled={loading}
          >
            <LogIn size={18} />
            <span>{loading ? 'Autenticando...' : 'Ingresar'}</span>
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-color)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Acceso rápido para demostración:
          </p>
          <button
            type="button"
            className="btn btn-outline"
            style={{ width: '100%', fontSize: '0.8rem', padding: '0.4rem' }}
            onClick={() => setCredencialesRapidas('cliente.demo', 'cliente123')}
          >
            Cargar credenciales de <strong>cliente.demo</strong>
          </button>
        </div>
      </div>
    </div>
  );
}
