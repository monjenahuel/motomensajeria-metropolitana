# Comandos para la demo de Tracking

## 1. Mostrar un cadete real

```bash
sudo docker compose up -d --build
```

Iniciar sesión como `cadete.demo` en el frontend de cadete y compartir una ubicación desde su aplicación. En el mapa del operador se verá esa posición, sin los 600 usuarios simulados.

## 2. Activar los 600 cadetes simulados

```bash
sudo docker compose --profile simulacion up -d simulator
```

El comando prepara los usuarios en Keycloak (`simulator-setup`) y luego arranca el simulador. Con 600 cadetes y un intervalo de 5 segundos, se esperan unos 120 reportes por segundo.

## 3. Ver coordenadas recibidas en vivo

Todos los reportes (aproximadamente 120 líneas por segundo):

```bash
sudo docker compose exec tracking-redis redis-cli --raw SUBSCRIBE tracking:posiciones
```

Solo un cadete simulado:

```bash
sudo docker compose exec -T tracking-redis redis-cli --raw SUBSCRIBE tracking:posiciones | grep --line-buffered 'cadete.sim.004'
```

El mensaje incluye `cadeteId`, `lat`, `lng`, `ts` y `recibidoEn`. Salir con `Ctrl+C` no detiene la simulación.

## 4. Detener solo la simulación

```bash
sudo docker compose stop simulator
```

El resto de la aplicación sigue activo. Los usuarios de prueba quedan en Keycloak; las posiciones de Redis expiran según su TTL.
