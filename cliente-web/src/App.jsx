import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import LoginForm from './components/LoginForm';
import CrearEnvioForm from './components/CrearEnvioForm';
import ListaEnvios from './components/ListaEnvios';
import DetalleEnvioModal from './components/DetalleEnvioModal';
import MapaEnvio from './components/MapaEnvio';
import { login, getMe, getEnvios, crearEnvio, getEnvioDetalle, cerrarSesionMapa } from './services/api';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [usuario, setUsuario] = useState(null);
  const [envios, setEnvios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [envioSeleccionado, setEnvioSeleccionado] = useState(null);
  const [seguimientoId, setSeguimientoId] = useState(null);

  // Al montar o cambiar token, validar sesión
  useEffect(() => {
    if (token) {
      cargarUsuarioYEnvios(token);
    } else {
      setUsuario(null);
      setEnvios([]);
    }
  }, [token]);

  const cargarUsuarioYEnvios = async (authToken) => {
    setLoading(true);
    try {
      const user = await getMe(authToken);
      setUsuario(user);
      const lista = await getEnvios(authToken);
      setEnvios(lista);
    } catch (err) {
      console.warn('Sesión no válida o expirada:', err.message);
      handleLogout();
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (username, password) => {
    const data = await login(username, password);
    const accessToken = data.access_token;
    localStorage.setItem('token', accessToken);
    setToken(accessToken);
  };

  const handleLogout = () => {
    void cerrarSesionMapa().catch(() => {});
    localStorage.removeItem('token');
    setToken('');
    setUsuario(null);
    setEnvios([]);
    setEnvioSeleccionado(null);
    setSeguimientoId(null);
  };

  const handleCrearEnvio = async (payload) => {
    await crearEnvio(token, payload);
    // Refrescar lista tras creación
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
      const lista = await getEnvios(token);
      setEnvios(lista);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar usuario={usuario} onLogout={handleLogout} />

      <main className="container" style={{ flex: 1, paddingBottom: '3rem' }}>
        {!token || !usuario ? (
          <LoginForm onLoginSuccess={handleLogin} />
        ) : seguimientoId ? (
          <MapaEnvio envioId={seguimientoId} token={token} onVolver={() => setSeguimientoId(null)} />
        ) : (
          <div>
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Panel de Envíos</h2>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  Gestioná y seguí en tiempo real tus solicitudes de mensajería
                </p>
              </div>
            </div>

            <CrearEnvioForm onCrear={handleCrearEnvio} />

            <ListaEnvios
              envios={envios}
              loading={loading}
              onRefresh={handleRefrescar}
              onVerDetalle={handleVerDetalle}
              onSeguimiento={setSeguimientoId}
            />
          </div>
        )}
      </main>

      <footer style={{ borderTop: '1px solid var(--border-color)', padding: '1.25rem 0', background: '#ffffff', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        <p>Motomensajería Metropolitana — Arquitectura de Software 1 · UNAHUR</p>
        <p style={{ fontSize: '0.725rem', marginTop: '0.25rem' }}>
          Stack PERN · Arquitectura Dirigida por Eventos (EDA) · Autenticación OIDC vía API Gateway
        </p>
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
