# syntax=docker/dockerfile:1
# Contexto de build: raiz do repositório (veja compose.yaml).

# --- Build do PWA -------------------------------------------------------------
FROM node:26.12.1-alpine AS build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend/ ./
# Só o modo local usa a chave de teste; o build do Firebase não a inclui.
COPY backend/src/test/resources/privateKey.pem /src/backend/src/test/resources/privateKey.pem
ARG VITE_AUTH_MODE=firebase
ARG VITE_FIREBASE_API_KEY=
ARG VITE_FIREBASE_AUTH_DOMAIN=
ARG VITE_FIREBASE_PROJECT_ID=
ARG VITE_FIREBASE_APP_ID=
RUN npm run build

# --- Entrega (nginx) ----------------------------------------------------------
FROM nginx:1.31.0-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html
EXPOSE 80
