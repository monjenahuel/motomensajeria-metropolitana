# ADR-0004: Adaptador de Mapas con caché, reintentos y fallback geográfico

- **Estado:** Aceptada
- **NFRs vinculados:** NFR-3 (Control de costos de API externa), NFR-5 (Resiliencia ante fallas externas)

## Contexto
Los proveedores externos de mapas (Nominatim para geocodificación y OSRM para ruteo, simulados en desarrollo con `mock-mapas`) tienen latencia variable, cuotas de uso y costo por consulta. Si cada reporte GPS del cadete o cada evento duplicado consultara al proveedor externo, el costo crecería linealmente con la frecuencia de GPS y una caída del proveedor dejaría al sistema sin ETA.

## Decisión
Encapsular toda interacción con el proveedor externo detrás del microservicio adaptador **`mapas/`**, gobernado por eventos de RabbitMQ (`mapas.envios`):

1. **Disparo acotado por hitos del envío (NFR-3):** solo consulta geocodificación/ruteo en eventos de negocio relevantes (`envio.creado` cuando faltan coordenadas, `envio.asignado` y transición a `EN_CAMINO`), **nunca** ante reportes periódicos de GPS.
2. **Caché de direcciones y rutas + deduplicación por `eventId`:** evita llamadas repetidas al proveedor ante direcciones recurrentes o reentregas del broker.
3. **Reintentos con backoff y fallback Haversine (NFR-5):** ante fallas del proveedor externo, `mapas` reintenta de forma acotada y, si persiste el error, calcula una estimación aproximada mediante distancia Haversine (`mapas/src/geo.js`) con velocidad de respaldo configurable (`VELOCIDAD_RESPALDO_KMH=25`), publicando `envio.eta_estimado` con `origenCalculo: "respaldo"`.

## Alternativas evaluadas
1. **Llamar al servicio de mapas directamente desde `envios` o `tracking` en cada request/GPS:** descartada porque acopla el core transaccional a la disponibilidad externa y dispara el consumo de cuota (viola NFR-3 y NFR-5).

## Consecuencias
- **Positivas:**
  - El flujo transaccional de `envios` nunca se bloquea ni falla si `mock-mapas`/OSRM está caído.
  - El número de consultas externas permanece acotado por envío (verificable vía `GET /stats` en `mock-mapas`).
- **Negativas / Riesgos:**
  - En modo `respaldo`, el ETA es una aproximación lineal sin tráfico real ni sentido de calles.
  - La caché actual vive en memoria del proceso `mapas` (suficiente para instancia única; requeriría Redis si se escala `mapas` a múltiples réplicas).
