#!/bin/sh
set -e
cd "$(dirname "$0")"
V=$(date -u +%Y%m%d%H%M%S)
printf '{"version":"%s"}\n' "$V" > version.json
sed -i -E "s/\?v=[0-9A-Za-z]+/?v=$V/g; s/(name=\"buildpdf-version\" content=\")[^\"]*/\1$V/" index.html
echo "$V"
