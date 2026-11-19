const sinBarraFinal = (valor) => (valor ? valor.replace(/\/+$/, '') : '');

// El navegador llama siempre al API Gateway (no a los microservicios internos).
export const API_URL = sinBarraFinal(import.meta.env.VITE_API_URL) || 'http://localhost:3000';

// Cliente público de Keycloak habilitado para password grant en la demo.
export const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'motomensajeria-web';
