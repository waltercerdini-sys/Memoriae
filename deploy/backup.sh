#!/usr/bin/env bash
# Copia di sicurezza: database e file cifrati delle cassaforti. Tiene gli ultimi 14 giorni.
# Gira ogni notte (cron) e prima di ogni aggiornamento.
set -euo pipefail
cd /opt/memoriae/deploy
QUANDO=$(date +%Y-%m-%d_%H%M)
DEST=dati/backup
mkdir -p "$DEST"
sudo docker compose exec -T db pg_dump -U memoriae memoriae | gzip > "$DEST/database_$QUANDO.sql.gz"
sudo tar -czf "$DEST/file_$QUANDO.tar.gz" -C dati/app file 2>/dev/null || true
find "$DEST" -name 'database_*.sql.gz' -mtime +14 -delete
find "$DEST" -name 'file_*.tar.gz' -mtime +14 -delete
echo "$(date '+%d.%m.%Y %H:%M') backup fatto: $(du -sh "$DEST" | cut -f1) in totale"
