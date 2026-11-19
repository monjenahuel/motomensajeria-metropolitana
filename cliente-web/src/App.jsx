import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from './components/Navbar';
import LoginForm from './components/LoginForm';
import CrearEnvioForm from './components/CrearEnvioForm';
import ListaEnvios from './components/ListaEnvios';
import DetalleEnvioModal from './components/DetalleEnvioModal';
import MapaEnvio from './components/MapaEnvio';
import {
  login,
  getMe,
  getEnvios,
  crearEnvio,
  getEnvioDetalle,
  getNotificaciones,
  suscribirNotificaciones,
  cerrarSesionMapa,
} from './services/api';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [usuario, setUsuario] = useState(null);
  const [envios, setEnvios] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncEstado, setSyncEstado] = useState('conectando');
  const [envioSeleccionado, setEnvioSeleccionado] = useState(null);
  const [seguimientoId, setSeguimientoId] = useState(null);

  const handleLogout = useCallback(() => {
    void cerrarSesionMapa().catch(() => {});
    localStorage.removeItem('token');
    setToken('');
    setUsuario(null);
    setEnvios([]);
    setAvisos([]);
    setEnvioSeleccionado(null);
    setSeguimientoId(null);
  }, []);

  const cargarTodo = useCallback(async (authToken) => {
    setLoading(true);
    try {
      const [user, lista, notas] = await Promise.all([
        getMe(authToken),
        getEnvios(authToken),
        getNotificaciones(authToken),
      ]);
      setUsuario(user);
      setEnvios(lista);
      setAvisos(notas.slice(-5).reverse());
    } catch (err) {
      console.warn('Sesión no válida o expirada:', err.message);
      handleLogout();
    } finally {
      setLoading(false);
    }
  }, [handleLogout]);

  useEffect(() => {
    if (!token) {
      setUsuario(null);
      setEnvios([]);
      setAvisos([]);
      return undefined;
    }

    void cargarTodo(token);
    const controller = new AbortController();

    void suscribirNotificaciones({
      token,
      signal: controller.signal,
      onEstado: setSyncEstado,
      onEvento: (aviso) => {
        if (aviso?.id) {
          setAvisos((prev) => [aviso, ...prev.filter((x) => x.id !== aviso.id)].slice(0, 5));
        }
        void getEnvios(token).then(setEnvios).catch(() => {});
      },
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void getEnvios(token).then(setEnvios).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, cargarTodo]);

  const handleLogin = async (username, password) => {
    const data = await login(username, password);
    localStorage.setItem('token', data.access_token);
    setToken(data.access_token);
  };

  const handleCrearEnvio = async (payload) => {
    await crearEnvio(token, payload);
    const lista = await getEnvios(token);
    setEnvios(lista);
  };

  const handleVerDetalle = async (id) => {
    try {
      const detalle = await getEnvioDetalle(token, id);
      setEnvioSeleccionado(detalle);
    } catch (err) {
      alert('Error al obtener detalle del envío: ' + err.message);
    }
  };

  const handleRefrescar = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [lista, notas] = await Promise.all([getEnvios(token), getNotificaciones(token)]);
      setEnvios(lista);
      setAvisos(notas.slice(-5).reverse());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => ({
    total: envios.length,
    pendientes: envios.filter((e) => e.estado === 'PENDIENTE').length,
    enCamino: envios.filter((e) => e.estado === 'EN_CAMINO').length,
    entregados: envios.filter((e) => e.estado === 'ENTREGADO').length,
  }), [envios]);

  if (!token || !usuario) {
    return <LoginForm onLoginSuccess={handleLogin} />;
  }

  return (
    <div className="app">
      <Navbar usuario={usuario} syncEstado={syncEstado} onLogout={handleLogout} />

      <main className="contenido">
        {seguimientoId ? (
          <MapaEnvio envioId={seguimientoId} token={token} onVolver={() => setSeguimientoId(null)} />
        ) : (
          <>
            <div className="stats">
              <div className="stat">
                <span className="stat-valor">{stats.total}</span>
                <span className="stat-etiqueta">Mis envíos</span>
              </div>
              <div className="stat stat-pendiente">
                <span className="stat-valor">{stats.pendientes}</span>
                <span className="stat-etiqueta">Pendientes</span>
              </div>
              <div className="stat stat-camino">
                <span className="stat-valor">{stats.enCamino}</span>
                <span className="stat-etiqueta">En camino</span>
              </div>
              <div className="stat stat-finalizado">
                <span className="stat-valor">{stats.entregados}</span>
                <span className="stat-etiqueta">Entregados</span>
              </div>
            </div>

            <CrearEnvioForm onCrear={handleCrearEnvio} />

            {avisos.length > 0 && (
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Últimos avisos</h2>
                    <p>Notificaciones recibidas en tiempo real desde RabbitMQ.</p>
                  </div>
                </div>
                <ul className="avisos-lista">
                  {avisos.map((a) => (
                    <li key={a.id} className="aviso-item">
                      <span>{a.mensaje}</span>
                      <span className="aviso-hora">
                        {new Date(a.creadaEn).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <ListaEnvios
              envios={envios}
              loading={loading}
              syncEstado={syncEstado}
              onRefresh={handleRefrescar}
              onVerDetalle={handleVerDetalle}
              onSeguimiento={setSeguimientoId}
            />
          </>
        )}
      </main>

      <footer className="footer">
        Motomensajería Metropolitana — Arquitectura de Software 1 · UNAHUR
      </footer>

      {envioSeleccionado && (
        <DetalleEnvioModal
          envio={envioSeleccionado}
          onClose={() => setEnvioSeleccionado(null)}
        />
      )}
    </div>
  );
}
