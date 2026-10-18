#!/usr/bin/env bash
# Puts this working copy on the server, in /var/www/clinic, where Roja's nginx site
# (soroushaz1/roja, server/nginx-pythonpath.conf) serves it at https://pythonpath.ir/clinic/.
# Only the files the app loads go up; the folder is swapped whole, so a visitor never
# meets half of one release and half of another. Safe to run again.
#
#   tools/deploy.sh                    # root@204.48.27.227 with ~/.ssh/roja_deploy
#   ROJA_HOST=root@… ROJA_KEY=… tools/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${ROJA_HOST:-root@204.48.27.227}
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
echo "done: https://pythonpath.ir/clinic/"
