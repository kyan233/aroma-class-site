#!/usr/bin/env bash
# Assembles src/pages/*.html + src/partials into the root html files.
# Usage: ./build.sh   (re-run after editing anything in src/)
set -euo pipefail
cd "$(dirname "$0")"
# cache-buster: changes whenever the css or js changes
VER=$(cat assets/css/site.css assets/js/site.js | shasum | cut -c1-8)
export VER
for page in src/pages/*.html; do
  name=$(basename "$page")
  title=$(sed -n 's/^<!-- title: \(.*\) -->$/\1/p' "$page" | head -1)
  desc=$(sed -n 's/^<!-- desc: \(.*\) -->$/\1/p' "$page" | head -1)
  active=$(sed -n 's/^<!-- active: \(.*\) -->$/\1/p' "$page" | head -1)
  hclass=$(sed -n 's/^<!-- header: \(.*\) -->$/\1/p' "$page" | head -1)
  body=$(grep -v '^<!-- \(title\|desc\|active\|header\): ' "$page")
  {
    TITLE="$title" DESC="$desc" ACTIVE="$active" HCLASS="$hclass" perl -pe '
      s/\{\{TITLE\}\}/$ENV{TITLE}/g; s/\{\{DESC\}\}/$ENV{DESC}/g; s/\{\{HEADER_CLASS\}\}/$ENV{HCLASS}/g; s/\{\{VER\}\}/$ENV{VER}/g;
      s/\{\{CUR_(\w+)\}\}/ ($1 eq $ENV{ACTIVE}) ? q{ aria-current="page"} : "" /ge;
    ' src/partials/head.html
    printf '%s\n' "$body"
    perl -pe 's/\{\{VER\}\}/$ENV{VER}/g' src/partials/footer.html
  } > "$name"
  echo "built $name"
done
