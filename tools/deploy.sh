#!/usr/bin/env bash
# Puts this working copy on the server, in /var/www/clinic, and serves it at
# https://tamirdesk.ir/ with this repository's nginx site (server/nginx-tamirdesk.conf).
# Roja's nginx site (soroushaz1/roja) still shows the same folder at
# https://pythonpath.ir/clinic/. Only the files the app loads go up; the folder is swapped
# whole, so a visitor never meets half of one release and half of another.
#
# The first time, it also gets tamirdesk.ir its certificate (certbot, through the web
# root) and steps aside any other enabled nginx site that answered for tamirdesk.ir: that
# site's file is moved to /etc/nginx/disabled-for-tamirdesk/, nothing is deleted. Safe to
# run again.
#
#   tools/deploy.sh                    # root@87.107.108.142 with ~/.ssh/roja_deploy
#   ROJA_HOST=root@… ROJA_KEY=… tools/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${ROJA_HOST:-root@87.107.108.142}
KEY=${ROJA_KEY:-$HOME/.ssh/roja_deploy}
ssh_(){ ssh -i "$KEY" -o BatchMode=yes "$HOST" "$@"; }

node tools/warp-check.mjs >/dev/null

SITE=(index.html present.html ./*.js clinic.css favicon.svg fonts icons THIRD-PARTY.md
  vendor/vision_bundle.js vendor/vision_bundle.mjs vendor/wasm vendor/face_landmarker.task vendor/LICENSE-Apache-2.0.txt)
echo "clinic → /var/www/clinic"
tar -cz "${SITE[@]}" | ssh_ 'set -e
  rm -rf /var/www/clinic.new && mkdir -p /var/www/clinic.new
  tar -xz -C /var/www/clinic.new
  chmod -R a+rX /var/www/clinic.new
  if [ -d /var/www/clinic ]; then mv /var/www/clinic /var/www/clinic.old; fi
  mv /var/www/clinic.new /var/www/clinic
  rm -rf /var/www/clinic.old'

echo "nginx site → tamirdesk.ir"
ssh_ 'cat > /tmp/nginx-tamirdesk.conf' < server/nginx-tamirdesk.conf
ssh_ 'set -e
  NEW=/tmp/nginx-tamirdesk.conf
  AVAIL=/etc/nginx/sites-available/tamirdesk
  ENABLED=/etc/nginx/sites-enabled/tamirdesk
  ASIDE=/etc/nginx/disabled-for-tamirdesk
  LIVE=/etc/letsencrypt/live/tamirdesk.ir
  install -d -m 755 /var/www/letsencrypt

  # Any other enabled site that names tamirdesk.ir would fight this one for it. One that
  # serves only tamirdesk.ir steps aside; one that also serves other domains is left
  # alone, and the deploy stops, so no other site goes down with it.
  for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
    [ -e "$f" ] || continue
    [ "$f" = "$ENABLED" ] && continue
    grep -Eq "server_name[^;]*[[:space:]](www\.)?tamirdesk\.ir[[:space:];]" "$f" || continue
    others=$(grep -Eo "server_name[^;]*" "$f" | tr -s " \t" "\n" | grep -v "^server_name$" \
      | grep -Ev "^$|^(www\.)?tamirdesk\.ir$" | sort -u | tr "\n" " " || true)
    if [ -n "$others" ]; then
      echo "error: $f serves tamirdesk.ir and also: $others" >&2
      echo "       take tamirdesk.ir out of its server_name lines, then deploy again." >&2
      exit 1
    fi
    install -d -m 755 "$ASIDE"
    echo "  moving $f aside, to $ASIDE/ (it served tamirdesk.ir before)"
    mv "$f" "$ASIDE/$(basename "$f").$(date +%Y%m%d%H%M%S)"
  done

  # No certificate yet: answer the challenge over plain HTTP first, then ask for one.
  if [ ! -s "$LIVE/fullchain.pem" ]; then
    echo "  no certificate for tamirdesk.ir yet, asking Let'"'"'s Encrypt"
    sed -n "/^server {/,/^}/p" "$NEW" | sed -n "1,/^}/p" > "$AVAIL"
    ln -sf "$AVAIL" "$ENABLED"
    nginx -t -q && systemctl reload nginx
    certbot certonly --webroot -w /var/www/letsencrypt -d tamirdesk.ir -d www.tamirdesk.ir \
      --non-interactive --keep-until-expiring --deploy-hook "systemctl reload nginx"
  fi

  # The whole site. If nginx does not take it, the site that was there stays.
  [ -e "$AVAIL" ] && cp "$AVAIL" "$AVAIL.prev"
  install -m 644 "$NEW" "$AVAIL"
  ln -sf "$AVAIL" "$ENABLED"
  if nginx -t -q; then
    systemctl reload nginx
    rm -f "$AVAIL.prev"
  else
    if [ -e "$AVAIL.prev" ]; then mv "$AVAIL.prev" "$AVAIL"; else rm -f "$ENABLED" "$AVAIL"; fi
    echo "error: nginx refused server/nginx-tamirdesk.conf; nothing changed" >&2
    exit 1
  fi
  rm -f "$NEW"'
echo "done: https://tamirdesk.ir/"
