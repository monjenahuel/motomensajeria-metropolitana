import { useEffect, useState } from 'react';
import { api } from '../api.js';

const INTERVALO_MS = 5000;

export default function ReporteUbicacion() {
  const [estado, setEstado] = useState('Solicitando ubicación…');

  useEffect(() => {
    if (!window.isSecureContext || !navigator.geolocation) {
      setEstado('GPS no disponible: abrí el panel desde HTTPS o localhost.');
      return undefined;
    }

    let activo = true;
    let enCurso = false;
    let permisoDenegado = false;
    let peticion = null;

    function reportar() {
      if (!activo || document.visibilityState !== 'visible' || enCurso || permisoDenegado) return;
      enCurso = true;

      navigator.geolocation.getCurrentPosition(
        async (posicion) => {
          if (!activo || document.visibilityState !== 'visible') {
            enCurso = false;
            return;
          }

          peticion = new AbortController();
          try {
            await api('/tracking/ubicaciones', {
              method: 'POST',
              body: JSON.stringify({
                lat: posicion.coords.latitude,
                lng: posicion.coords.longitude,
                ts: posicion.timestamp,
                ...(posicion.coords.heading != null && Number.isFinite(posicion.coords.heading)
                  ? { rumbo: posicion.coords.heading }
                  : {}),
              }),
              signal: peticion.signal,
            });
            if (activo) setEstado(`Ubicación compartida · ${new Date().toLocaleTimeString('es-AR')}`);
          } catch (error) {
            if (activo && error.name !== 'AbortError') setEstado(`No se pudo enviar la ubicación: ${error.message}`);
          } finally {
            peticion = null;
            enCurso = false;
          }
        },
        (error) => {
          enCurso = false;
          if (!activo || document.visibilityState !== 'visible') return;
          if (error.code === 1) {
            permisoDenegado = true;
            setEstado('Permiso de ubicación denegado. Habilitalo en el navegador y recargá la página.');
          } else {
            setEstado('Esperando señal GPS para compartir ubicación…');
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
      );
    }

    function alCambiarVisibilidad() {
      if (document.visibilityState !== 'visible') {
        peticion?.abort();
        setEstado('Ubicación pausada: la página está en segundo plano.');
      } else if (!permisoDenegado) {
        setEstado('Obteniendo ubicación…');
        reportar();
      }
    }

    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    const intervalo = window.setInterval(reportar, INTERVALO_MS);
    reportar();

    return () => {
      activo = false;
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      peticion?.abort();
    };
  }, []);

  return <p className="estado-gps" role="status">GPS: {estado}</p>;
}
