import { crearMock } from './server.js';

const port = Number(process.env.PORT ?? 4000);
const server = crearMock({
  latenciaMs: Number(process.env.LATENCIA_MS ?? 150),
  velocidadKmh: Number(process.env.VELOCIDAD_KMH ?? 25),
  falla: process.env.MOCK_FALLA === 'true',
});
server.listen(port, () => console.log(`Mock de mapas escuchando en el puerto ${port}`));
