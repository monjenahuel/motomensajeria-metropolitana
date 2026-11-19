FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Variables de Vite: se hornean en el bundle durante el build.
# El navegador llama al gateway, que reenvía las ubicaciones a Tracking.
ARG VITE_API_URL=http://localhost:3000
ARG VITE_KEYCLOAK_CLIENT_ID=motomensajeria-web
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID

RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
