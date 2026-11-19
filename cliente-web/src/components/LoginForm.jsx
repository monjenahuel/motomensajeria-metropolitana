import React, { useState } from 'react';

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

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand login-brand">
          <span className="brand-mark">MM</span>
          <div className="brand-text">
            <strong>MotoMensajería</strong>
            <span>Portal del Cliente</span>
          </div>
        </div>

        <h1>Iniciar sesión</h1>
        <p className="muted">Autenticación OIDC centralizada vía API Gateway.</p>

        <form className="form" onSubmit={handleSubmit}>
          <label>
            Usuario
            <input
              className="input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="cliente.demo"
              autoComplete="username"
              required
            />
          </label>

          <label>
            Contraseña
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="alerta alerta-error" role="alert">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <div className="login-demo">
          Cuenta demo: <strong>cliente.demo</strong> / <code>cliente123</code>{' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: '6px' }}
            onClick={() => { setUsername('cliente.demo'); setPassword('cliente123'); }}
          >
            Usar
          </button>
        </div>
      </div>
    </div>
  );
}
