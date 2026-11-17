#!/usr/bin/env bash
# Installa MEMORIAE su un server Ubuntu 24.04 nuovo (Infomaniak Public Cloud).
# Uso, dal server:  curl -fsSL … | bash   oppure   bash installa.sh
# Si può rilanciare senza danni: ciò che è già fatto viene saltato.
set -euo pipefail

CARTELLA=/opt/memoriae
REPO=git@github.com:waltercerdini-sys/memoriae.git
CHIAVE_GITHUB="$HOME/.ssh/memoriae_github"

passo() { printf '\n\033[1;32m▶ %s\033[0m\n' "$1"; }
chiedi() { local r; read -r -p "$1 [$2]: " r </dev/tty; echo "${r:-$2}"; }

passo "1/6  Aggiornamento del sistema e installazione di Docker"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 git cron unattended-upgrades >/dev/null
sudo systemctl enable --now docker >/dev/null
sudo usermod -aG docker "$USER"
# Aggiornamenti di sicurezza automatici del sistema.
sudo dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null

passo "2/6  Chiave per leggere il codice da GitHub"
if [ ! -f "$CHIAVE_GITHUB" ]; then
  ssh-keygen -q -t ed25519 -N "" -C "server-memoriae" -f "$CHIAVE_GITHUB"
fi
grep -q memoriae_github "$HOME/.ssh/config" 2>/dev/null || cat >> "$HOME/.ssh/config" <<CONF
Host github.com
  IdentityFile $CHIAVE_GITHUB
  IdentitiesOnly yes
CONF
chmod 600 "$HOME/.ssh/config"
ssh-keyscan -q github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
github_ok() { local out; out=$(ssh -o BatchMode=yes -T git@github.com 2>&1 || true); grep -q "successfully authenticated" <<<"$out"; }
if ! github_ok; then
  echo
  echo "Su GitHub apri il repository › Settings › Deploy keys › Add deploy key."
  echo "Titolo: server memoriae   ·   NON spuntare «Allow write access»   ·   incolla questa riga:"
  echo
  cat "$CHIAVE_GITHUB.pub"
  echo
  read -r -p "Quando l'hai aggiunta, premi Invio… " _ </dev/tty
  github_ok || { echo "GitHub non accetta ancora la chiave: ricontrolla e rilancia lo script."; exit 1; }
fi

passo "3/6  Download del codice in $CARTELLA"
sudo mkdir -p "$CARTELLA"
sudo chown "$USER:$USER" "$CARTELLA"
if [ -d "$CARTELLA/.git" ]; then git -C "$CARTELLA" pull -q; else git clone -q "$REPO" "$CARTELLA"; fi
cd "$CARTELLA/deploy"

passo "4/6  Impostazioni (deploy/.env)"
if [ ! -f .env ]; then
  APP=$(chiedi "Indirizzo dell'app" "app.memoriae.ch")
  SITO=$(chiedi "Indirizzo del sito" "memoriae.ch")
  EMAIL=$(chiedi "E-mail per i certificati HTTPS (avvisi di scadenza)" "info@memoriae.ch")
  UTENTE=$(chiedi "Anteprima: nome per entrare" "memoriae")
  read -r -s -p "Anteprima: password per entrare (la userai su telefono e computer): " PW </dev/tty; echo
  [ -n "$PW" ] || { echo "Serve una password."; exit 1; }
  cat > .env <<CONF
# Impostazioni di MEMORIAE su questo server. Mai nel repository, mai in chat.
# ANTEPRIMA: pagamenti di prova, e-mail solo nel registro, accesso con nome e password.
# Per passare alla produzione vedi deploy/LEGGIMI.md.
CADDYFILE=Caddyfile.anteprima
APP_DOMINIO=$APP
SITO_DOMINIO=$SITO
CADDY_EMAIL=$EMAIL
DB_PASSWORD=$(openssl rand -hex 24)

NODE_ENV=development
COOKIE_SECURE=true
LOG_LEVEL=info
# Le passkey valgono per tutto il dominio: non cambiarlo mai dopo il lancio.
WEBAUTHN_RP_ID=$SITO
WEBAUTHN_ORIGINS=https://$APP
APP_ORIGIN=https://$APP
PAYMENTS_PROVIDER=prova
# In anteprima l'attesa dopo la verifica dura 10 minuti invece di 14 giorni / 72 ore.
ATTESA_PROVA_SECONDI=600
CONF
  chmod 600 .env
  HASH=$(sudo docker run --rm caddy:2.8.4 caddy hash-password --plaintext "$PW")
  printf 'basic_auth {\n\t%s %s\n}\n' "$UTENTE" "$HASH" > anteprima.caddy
  chmod 600 anteprima.caddy
else
  echo "deploy/.env esiste già: lo lascio com'è."
fi
[ -f anteprima.caddy ] || : > anteprima.caddy
mkdir -p dati/app dati/postgres dati/caddy dati/backup

passo "5/6  Avvio di MEMORIAE (la prima volta 3–5 minuti)"
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null

passo "6/6  Backup ogni notte alle 03:15"
sudo tee /etc/cron.d/memoriae-backup >/dev/null <<CRON
15 3 * * * $USER bash $CARTELLA/deploy/backup.sh >> $CARTELLA/deploy/dati/backup/backup.log 2>&1
CRON

APP_DOMINIO=$(grep '^APP_DOMINIO=' .env | cut -d= -f2)
echo
echo "Fatto. Fra un minuto apri https://$APP_DOMINIO (se i DNS sono già attivi)."
echo
echo "IMPORTANTE: la chiave principale della custodia è in $CARTELLA/deploy/dati/app/custodia.key."
echo "Se si perde, le cassaforti non si possono più aprire per gli eredi. Copiala SUBITO su una chiavetta,"
echo "dal Mac:  scp ubuntu@<indirizzo>:$CARTELLA/deploy/dati/app/custodia.key ~/Desktop/"
echo "poi spostala sulla chiavetta, cancellala dalla Scrivania e tieni la chiavetta in cassaforte."
