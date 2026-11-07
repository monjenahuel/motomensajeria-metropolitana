import { useState } from 'react';
import { login } from '../session.js';

export default function Login() {
  const [username, setUsername] = useState('operador.demo');
  const [password, setPassword] = useState('operador123');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(evento) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand login-brand">
          <span className="brand-mark">MM</span>
          <div className="brand-text">
            <strong>MotoMensajería</strong>
            <span>Panel de Operador</span>
          </div>
        </div>

        <h1>Iniciar sesión</h1>
        <p className="muted">
          Ingresá con un usuario con rol <code>operador</code> o <code>administrador</code>.
        </p>

        <form className="form" onSubmit={onSubmit}>
          <label>
            Usuario
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="alerta alerta-error">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={enviando}>
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <div className="login-demo">
          <strong>Credenciales de demo</strong>
          <span><code>operador.demo</code> / <code>operador123</code></span>
          <span><code>admin.demo</code> / <code>admin123</code></span>
        </div>

        <p className="login-foot">
          Autenticación vía API Gateway → Keycloak (password grant, solo para la demo).
        </p>
      </div>
    </div>
  );
}
