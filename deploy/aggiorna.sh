#!/usr/bin/env bash
# Porta il server all'ultima versione di GitHub. Uso:  bash /opt/memoriae/deploy/aggiorna.sh
set -euo pipefail
cd /opt/memoriae
bash deploy/backup.sh
git pull -q
cd deploy
sudo docker compose up -d --build
# Caddy rilegge la sua configurazione (se è cambiata con l'aggiornamento).
sudo docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
sudo docker image prune -f >/dev/null
echo "MEMORIAE aggiornata alla versione $(git -C /opt/memoriae log -1 --format='%h del %cd' --date=format:'%d.%m.%Y %H:%M')."
