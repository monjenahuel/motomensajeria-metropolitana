import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getSession, subscribe, logout } from './session.js';
import { api } from './api.js';
import { claseEstado, ESTADO_LABEL, esFinal, fecha, idCorto } from './format.js';
import Login from './components/Login.jsx';
import Modal from './components/Modal.jsx';
import ReporteUbicacion from './components/ReporteUbicacion.jsx';

export default function App() {
  const session = useSyncExternalStore(subscribe, getSession);
  return session ? <Panel key={session.user.username} session={session} /> : <Login />;
}

function Panel({ session }) {
  const [envios, setEnvios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('TODOS');
  const [seleccion, setSeleccion] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const datos = await api('/cadete/envios');
      setEnvios(datos);
      setError('');
    } catch (err) {
      setError(err.message || 'No se pudieron cargar tus envíos.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    const timer = window.setInterval(cargar, 15000);
    return () => window.clearInterval(timer);
  }, [cargar]);

  async function cambiar(estado, motivo) {
    const actualizado = await api(`/cadete/envios/${seleccion.id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado, motivo: motivo.trim() }),
    });
    setEnvios((lista) => lista.map((e) => e.id === actualizado.id ? actualizado : e));
    setSeleccion(null);
    setAviso(`Envío ${idCorto(actualizado.id)}: ${ESTADO_LABEL[actualizado.estado]}.`);
    await cargar();
  }

  const filtrados = envios.filter((e) =>
    (filtro === 'TODOS' || e.estado === filtro)
    && [e.id, e.origen, e.destino, e.cliente].join(' ').toLowerCase().includes(busqueda.trim().toLowerCase()));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">MM</span><div className="brand-text"><strong>MotoMensajería</strong><span>Panel de Cadete</span></div></div>
        <div className="topbar-right"><strong>{session.user.username}</strong><button className="btn btn-ghost" onClick={logout}>Salir</button></div>
      </header>
      <main className="contenido">
        <ReporteUbicacion />
        {error && <div className="alerta alerta-error" role="alert">{error}<button className="btn" onClick={cargar}>Reintentar</button></div>}
        {aviso && <p role="status">{aviso}</p>}
        <div className="stats">
          {[['Mis envíos', envios.length], ['Activos', envios.filter((e) => !esFinal(e.estado)).length], ['Finalizados', envios.filter((e) => esFinal(e.estado)).length]].map(([label, total]) => (
            <div className="stat" key={label}><span className="stat-valor">{total}</span><span className="stat-etiqueta">{label}</span></div>
          ))}
        </div>
        <section className="panel">
          <div className="panel-head"><div><h2>Mis envíos</h2><p>Actualización automática cada 15 segundos. Hasta 100 envíos asignados a tu usuario.</p></div><button className="btn btn-ghost" onClick={cargar} disabled={cargando}>Actualizar</button></div>
          <div className="filtros">
            <input className="input" type="search" aria-label="Buscar envíos" placeholder="Buscar por ID, recorrido o cliente" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            <select className="input" aria-label="Filtrar por estado" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="TODOS">Todos los estados</option>
              {Object.entries(ESTADO_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {cargando && <p className="vacio">Cargando envíos…</p>}
          {!cargando && !filtrados.length && <p className="vacio">No hay envíos que coincidan con el filtro.</p>}
          <div className="envios-grid">
            {filtrados.map((e) => (
              <article className="envio-card" key={e.id}>
                <div className="panel-tools"><code title={e.id}>{idCorto(e.id)}</code><span className={claseEstado(e.estado)}>{ESTADO_LABEL[e.estado] || e.estado}</span></div>
                <dl><dt>Origen</dt><dd>{e.origen}</dd><dt>Destino</dt><dd>{e.destino}</dd><dt>Cliente</dt><dd>{e.cliente}</dd><dt>Asignado</dt><dd>{fecha(e.fecha_asignacion)}</dd><dt>Actualizado</dt><dd>{fecha(e.actualizado_en)}</dd></dl>
                {!esFinal(e.estado) && <button className="btn btn-primary btn-block" onClick={() => { setAviso(''); setSeleccion(e); }}>Cambiar estado</button>}
              </article>
            ))}
          </div>
        </section>
      </main>
      {seleccion && <CambiarEstado envio={seleccion} onCerrar={() => setSeleccion(null)} onGuardar={cambiar} />}
    </div>
  );
}

function CambiarEstado({ envio, onCerrar, onGuardar }) {
  const opciones = ['EN_CAMINO', 'ENTREGADO', 'NO_ENTREGADO'].filter((e) => e !== envio.estado);
  const [estado, setEstado] = useState(opciones[0]);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  async function guardar(event) {
    event.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError('');
    try { await onGuardar(estado, motivo); }
    catch (err) { setError(err.message || 'No se pudo cambiar el estado.'); }
    finally { setEnviando(false); }
  }
  return (
    <Modal titulo={`Cambiar estado · ${idCorto(envio.id)}`} subtitulo={`${envio.origen} → ${envio.destino}`} onCerrar={() => { if (!enviando) onCerrar(); }}>
      <p>Estado actual: <strong>{ESTADO_LABEL[envio.estado]}</strong></p>
      <form className="form" onSubmit={guardar}>
        <label>Nuevo estado<select className="input" value={estado} onChange={(e) => setEstado(e.target.value)} disabled={enviando}>{opciones.map((e) => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}</select></label>
        <label>Motivo (opcional)<input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={enviando} placeholder="Ej.: destinatario ausente" /></label>
        {esFinal(estado) && <p className="hint">Al finalizar el envío, ya no se podrá modificar su estado.</p>}
        {error && <div className="alerta alerta-error" role="alert">{error}</div>}
        <div className="modal-acciones"><button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={enviando}>Cancelar</button><button className="btn btn-primary" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar estado'}</button></div>
      </form>
    </Modal>
  );
}
