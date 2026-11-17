# MEMORIAE in produzione: server (API e lavori periodici) + app web e sito già compilati.
# I file compilati vengono copiati all'avvio nel volume che Caddy pubblica (vedi deploy/avvio.sh).
FROM node:22-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/crypto/package.json packages/crypto/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/site/package.json packages/site/
RUN npm ci --no-audit --no-fund

COPY . .
# Indirizzo della guida in PDF sul sito (facoltativo): rende cliccabile il capitolo nell'aiuto.
ARG VITE_GUIDA_URL=
ENV VITE_GUIDA_URL=$VITE_GUIDA_URL
RUN npm run build -w @memoriae/web && npm run build -w @memoriae/site

EXPOSE 3000
CMD ["sh", "deploy/avvio.sh"]
