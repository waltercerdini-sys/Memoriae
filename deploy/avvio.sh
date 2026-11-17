#!/bin/sh
# Avvio del contenitore dell'app: pubblica app e sito, aggiorna il database, accende il server.
set -e
mkdir -p /srv/app /srv/sito
rm -rf /srv/app/* /srv/sito/*
cp -r packages/web/dist/. /srv/app/
cp -r packages/site/dist/. /srv/sito/
npm run db:migrate -w @memoriae/server
exec node_modules/.bin/tsx packages/server/src/server.ts
