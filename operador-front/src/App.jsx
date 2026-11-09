import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from './api.js';
import { getSession, logout, subscribe } from './session.js';
import { iniciales, esVigente, idCorto } from './format.js';
import Login from './components/Login.jsx';
import EnviosPage from './components/EnviosPage.jsx';
import AsignacionesPage from './components/AsignacionesPage.jsx';
import MapaPage from './components/MapaPage.jsx';
import AsignarModal from './components/AsignarModal.jsx';
import DetalleModal from './components/DetalleModal.jsx';
import LiberarModal from './components/LiberarModal.jsx';
import Toasts from './components/Toasts.jsx';

function useSession() {
  return useSyncExternalStore(subscribe, getSession);
}

export default function App() {
  const session = useSession();
  if (!session) return <Login />;
  return <PanelOperador session={session} />;
}

function PanelOperador({ session }) {
  const [tab, setTab] = useState('envios');
  const [envioEnMapa, setEnvioEnMapa] = useState(null);
  const [envios, setEnvios] = useState([]);
  const [asignaciones, setAsignaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [actualizado, setActualizado] = useState(null);
  const [auto, setAuto] = useState(true);

  const [toasts, setToasts] = useState([]);
  const [asignarA, setAsignarA] = useState(null);
  const [detalleId, setDetalleId] = useState(null);
  const [liberarA, setLiberarA] = useState(null);

  const notificar = useCallback((tipo, mensaje) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((lista) => [...lista, { id, tipo, mensaje }]);
    window.setTimeout(() => {
      setToasts((lista) => lista.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCargando(true);
    try {
      const [listaEnvios, listaAsignaciones] = await Promise.all([
        api('/envios'),
        api('/operador/asignaciones'),
      ]);
      setEnvios(listaEnvios);
      setAsignaciones(listaAsignaciones);
      setError(null);
      setActualizado(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      const mensaje = err.message || 'No se pudieron cargar los datos.';
      setError(mensaje);
      if (!silencioso) notificar('error', mensaje);
    } finally {
      if (!silencioso) setCargando(false);
    }
  }, [notificar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (!auto) return undefined;
    const id = window.setInterval(() => {
      void cargar({ silencioso: true });
    }, 15_000);
    return () => window.clearInterval(id);
  }, [auto, cargar]);

  async function asignar(envio, mensajero) {
    await api(`/envios/${envio.id}/asignar`, {
      method: 'PATCH',
      body: JSON.stringify({ mensajero }),
    });
    notificar('ok', `Envío ${idCorto(envio.id)} asignado a ${mensajero}.`);
    setAsignarA(null);
    await cargar({ silencioso: true });
  }

  async function liberar(envio) {
    await api(`/operador/asignaciones/${envio.id}`, { method: 'DELETE' });
    notificar('ok', `Asignación del envío ${idCorto(envio.id)} liberada.`);
    setLiberarA(null);
    await cargar({ silencioso: true });
  }

  function abrirSeguimiento(envioId) {
    setEnvioEnMapa(envioId);
    setTab('mapa');
  }

  const vigentes = asignaciones.filter((e) => esVigente(e.estado)).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">MM</span>
          <div className="brand-text">
            <strong>MotoMensajería</strong>
            <span>Panel de Operador</span>
          </div>
        </div>

        <div className="topbar-right">
          <label className="switch" title="Actualizar datos cada 15 segundos">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>Auto</span>
          </label>

          <div className="user">
            <span className="user-avatar">{iniciales(session.user.username)}</span>
            <div className="user-text">
              <strong>{session.user.username}</strong>
              <span>{session.user.roles.filter((r) => r === 'operador' || r === 'administrador').join(', ') || 'operador'}</span>
            </div>
          </div>

          <button type="button" className="btn btn-ghost" onClick={logout}>Salir</button>
        </div>
      </header>

      <nav className="tabs" aria-label="Secciones">
        <button type="button" className={tab === 'envios' ? 'tab activo' : 'tab'} onClick={() => setTab('envios')}>
          Envíos <span className="pill">{envios.length}</span>
        </button>
        <button type="button" className={tab === 'asignaciones' ? 'tab activo' : 'tab'} onClick={() => setTab('asignaciones')}>
          Asignaciones <span className="pill">{vigentes}</span>
        </button>
        <button type="button" className={tab === 'mapa' ? 'tab activo' : 'tab'} onClick={() => { setEnvioEnMapa(null); setTab('mapa'); }}>
          Mapa en vivo
        </button>
      </nav>

      <main className="contenido">
        {error && (
          <div className="alerta alerta-error">
            <span>{error}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => cargar()}>Reintentar</button>
          </div>
        )}

        {tab === 'envios' && (
          <EnviosPage
            envios={envios}
            cargando={cargando}
            actualizado={actualizado}
            auto={auto}
            onAuto={setAuto}
            onRefrescar={() => cargar()}
            onAsignar={setAsignarA}
            onLiberar={setLiberarA}
            onDetalle={setDetalleId}
            onSeguimiento={abrirSeguimiento}
          />
        )}

        {tab === 'asignaciones' && (
          <AsignacionesPage
            asignaciones={asignaciones}
            cargando={cargando}
            actualizado={actualizado}
            auto={auto}
            onAuto={setAuto}
            onRefrescar={() => cargar()}
            onLiberar={setLiberarA}
            onDetalle={setDetalleId}
            onSeguimiento={abrirSeguimiento}
          />
        )}

        {tab === 'mapa' && <MapaPage envioId={envioEnMapa} onVerTodos={() => setEnvioEnMapa(null)} />}
      </main>

      {asignarA && (
        <AsignarModal
          envio={asignarA}
          onCerrar={() => setAsignarA(null)}
          onAsignar={asignar}
        />
      )}

      {detalleId && (
        <DetalleModal envioId={detalleId} onCerrar={() => setDetalleId(null)} />
      )}

      {liberarA && (
        <LiberarModal
          envio={liberarA}
          onCerrar={() => setLiberarA(null)}
          onConfirmar={liberar}
        />
      )}

      <Toasts toasts={toasts} onCerrar={(id) => setToasts((lista) => lista.filter((t) => t.id !== id))} />
    </div>
  );
}
