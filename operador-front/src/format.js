export const ESTADOS = ['PENDIENTE', 'ASIGNADO', 'EN_CAMINO', 'ENTREGADO', 'NO_ENTREGADO', 'CANCELADO'];

export const ESTADOS_FINALES = ['ENTREGADO', 'NO_ENTREGADO', 'CANCELADO'];

export const ESTADO_LABEL = {
  PENDIENTE: 'Pendiente',
  ASIGNADO: 'Asignado',
  EN_CAMINO: 'En camino',
  ENTREGADO: 'Entregado',
  NO_ENTREGADO: 'No entregado',
  CANCELADO: 'Cancelado',
};

export function claseEstado(estado) {
  return `badge badge-${String(estado || '').toLowerCase().replace(/_/g, '-')}`;
}

export function fecha(valor) {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

export function hora(valor = Date.now()) {
  return new Intl.DateTimeFormat('es-AR', { timeStyle: 'medium' }).format(new Date(valor));
}

export function idCorto(id) {
  if (!id) return '—';
  const valor = String(id);
  // En UUID v7 el prefijo es un timestamp: el final identifica mejor cada envío.
  return valor.length > 8 ? valor.slice(-8) : valor;
}

export function iniciales(username = '') {
  return username
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0].toUpperCase())
    .join('') || 'OP';
}

export function esFinal(estado) {
  return ESTADOS_FINALES.includes(estado);
}

export function esVigente(estado) {
  return estado === 'ASIGNADO' || estado === 'EN_CAMINO';
}
