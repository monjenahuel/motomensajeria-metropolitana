export function idCorto(id) {
  if (!id) return '—';
  const valor = String(id);
  // En UUID v7 el prefijo es un timestamp: el final identifica mejor cada envío.
  return valor.length > 8 ? valor.slice(-8) : valor;
}
