#!/usr/bin/env bash
# Deployt den statischen Build (dist/) per SFTP auf das Strato-Webhosting-Paket. Im selben
# Paket liegt in /htdocs eine andere Seite. Zugangsdaten kommen aus .env.deploy (lokal, nicht
# versioniert) oder aus der Umgebung.
set -euo pipefail

cd "$(dirname "$0")"

if [ -f .env.deploy ]; then
  set -a
  source .env.deploy
  set +a
fi

: "${STRATO_FTP_HOST:?Bitte STRATO_FTP_HOST in .env.deploy setzen}"
: "${STRATO_FTP_USER:?Bitte STRATO_FTP_USER in .env.deploy setzen}"
: "${STRATO_FTP_PASSWORD:?Bitte STRATO_FTP_PASSWORD in .env.deploy setzen}"
# Ohne Standardwert. Ein Rueckfall auf "/" wuerde mit "mirror --delete" das ganze Paket
# leeren, die andere Seite eingeschlossen.
: "${STRATO_REMOTE_PATH:?Bitte STRATO_REMOTE_PATH in .env.deploy setzen (/ganymed)}"
: "${STRATO_SFTP_PORT:=22}"

# Die Sperre, auf die es ankommt. Die andere Seite wird nach /htdocs gespiegelt, diese liegt
# daneben. Zeigt das Ziel auf die Wurzel, auf /htdocs oder in /htdocs hinein, loescht
# "mirror --delete" Dateien der anderen Seite - oder deren Deploy loescht diese. Beides faellt erst auf, wenn eine
# der Seiten weg ist.
#
# Erlaubt ist nur, was sicher ist, statt aufzuzaehlen, was verboten ist: Eine Verbotsliste liess
# "/ganymed/../htdocs" durch. Also nur absolute Pfade aus einfachen Namen, ohne "." und "..".
ziel="${STRATO_REMOTE_PATH%/}"
if ! [[ "$ziel" =~ ^(/[A-Za-z0-9_-]+)+$ ]]; then
  echo "Abbruch: STRATO_REMOTE_PATH muss ein Ordner wie /ganymed sein, ist aber \"${STRATO_REMOTE_PATH}\"." >&2
  exit 1
fi
case "$ziel" in
  /htdocs | /htdocs/*)
    echo "Abbruch: \"${STRATO_REMOTE_PATH}\" gehoert einer anderen Seite. Diese liegt neben /htdocs, nicht darin." >&2
    exit 1
    ;;
esac

MIRROR_FLAGS="-R --verbose"
DELETE_FLAG="--delete"
if [ "${1:-}" = "--dry-run" ]; then
  echo "Trockenlauf: Es wird NICHTS hochgeladen oder gelöscht, nur angezeigt was passieren würde."
  MIRROR_FLAGS="${MIRROR_FLAGS} --dry-run"
  DELETE_FLAG=""
fi

echo "Baue statische Seite..."
npm run build

# Die .htaccess kommt aus public/ mit dem Build. Fehlt sie, liefe die Seite ohne CSP und
# mit falschem WASM-Typ - das soll nicht still passieren.
if [ ! -f dist/.htaccess ]; then
  echo "Abbruch: dist/.htaccess fehlt. Sie muss aus public/.htaccess mitkommen." >&2
  exit 1
fi

# Baustellenseite: Solange eine Datei WARTUNG im Projektordner liegt,
# beantwortet der Server jede Seite mit 503 und zeigt /wartung/. Als versionierte Datei, nicht
# als Schalter beim Aufruf, damit der nächste Push auf main sie nicht still wieder abschaltet.
# Erreichbar bleiben, was die Baustellenseite selbst braucht (/_astro/, Favicon), und
# Impressum und Datenschutz, die auch während der Wartung abrufbar sein müssen.
if [ -f WARTUNG ]; then
  echo "Baustellenseite wird aktiviert."
  cat >> dist/.htaccess << 'HTEOF'

# Von deploy.sh angehängt, weil die Datei WARTUNG existiert.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{REQUEST_URI} !^/wartung/
  RewriteCond %{REQUEST_URI} !^/_astro/
  RewriteCond %{REQUEST_URI} !^/favicon\.svg$
  RewriteCond %{REQUEST_URI} !^/(impressum|datenschutz)/
  RewriteRule ^ - [R=503,L]
</IfModule>
# 503 statt Weiterleitung: sagt Suchmaschinen "vorübergehend", nicht "hier ist jetzt nichts".
ErrorDocument 503 /wartung/index.html
<IfModule mod_headers.c>
  Header always set Retry-After "86400"
</IfModule>
HTEOF
fi

# Fehlende Angaben im Impressum oder in der Datenschutzerklärung sind mit <Placeholder>
# markiert. Live gehen dürfen sie nicht. Ein Trockenlauf zeigt sie nur an.
if grep -rl 'data-placeholder' dist --include='*.html' >/dev/null; then
  echo "Noch offene Platzhalter in:" >&2
  grep -rl 'data-placeholder' dist --include='*.html' | sed 's#^dist/#  #' >&2
  if [ "${1:-}" != "--dry-run" ]; then
    echo "Abbruch: Erst die Platzhalter füllen." >&2
    exit 1
  fi
fi

# In drei Schritten statt einem Abgleich. In /_astro/ und /vendor/ steht eine Prüfsumme oder
# Version im Dateinamen: Gleicher Name heißt gleicher Inhalt. Dort genügt deshalb der
# Vergleich der Größe (--ignore-time), und Unverändertes bleibt liegen. Ohne das ginge bei
# jedem Lauf alles neu hoch, denn auf dem Runner ist jede Datei frisch ausgecheckt und damit
# "neuer". Allein Ghostscript sind 15 MB, ein Deploy dauerte so rund 11 Minuten.
# Reihenfolge: erst neue Dateien hoch, dann die Seiten, die auf sie verweisen, und erst
# zuletzt die alten weg. So zeigt keine Seite, auch nicht kurz, auf eine fehlende Datei.
echo "Lade dist/ nach ${STRATO_FTP_HOST}:${ziel} hoch (SFTP)..."
# stdout/stderr werden gefiltert, damit Benutzername/Passwort nie im Klartext
# im Terminal-Log auftauchen (lftp bettet sie sonst in der Befehls-Vorschau ein).
lftp -u "${STRATO_FTP_USER}","${STRATO_FTP_PASSWORD}" "sftp://${STRATO_FTP_HOST}:${STRATO_SFTP_PORT}" <<EOF 2>&1 | sed -E "s#(sftp://[^:@/]+):[^@]*@#\1:***@#g"
set sftp:auto-confirm yes
mirror ${MIRROR_FLAGS} --ignore-time dist/_astro/ "${ziel}/_astro"
mirror ${MIRROR_FLAGS} --ignore-time dist/vendor/ "${ziel}/vendor"
mirror ${MIRROR_FLAGS} ${DELETE_FLAG} --exclude ^_astro/ --exclude ^vendor/ dist/ "${ziel}"
mirror ${MIRROR_FLAGS} ${DELETE_FLAG} --ignore-time dist/_astro/ "${ziel}/_astro"
mirror ${MIRROR_FLAGS} ${DELETE_FLAG} --ignore-time dist/vendor/ "${ziel}/vendor"
quit
EOF

echo "Deploy abgeschlossen."
