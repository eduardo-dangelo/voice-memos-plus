#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ROOT="$ROOT/landing/assets/screenshots"
OUT_ROOT="$ROOT/appstoreconnect"

IPHONE_W=1242
IPHONE_H=2688
IPAD_W=2752
IPAD_H=2064

SCENES=(hero edit effects track-menu loop)
NAMES=(01-hero 02-edit 03-effects 04-track-menu 05-loop)

cover_resize() {
  local src="$1"
  local out="$2"
  local tw="$3"
  local th="$4"

  local sw sh
  sw="$(sips -g pixelWidth "$src" | awk '/pixelWidth/{print $2}')"
  sh="$(sips -g pixelHeight "$src" | awk '/pixelHeight/{print $2}')"

  local nw nh
  read -r nw nh <<<"$(awk -v sw="$sw" -v sh="$sh" -v tw="$tw" -v th="$th" 'BEGIN {
    sx = tw / sw
    sy = th / sh
    s = (sx > sy) ? sx : sy
    nw = int(sw * s + 0.5)
    nh = int(sh * s + 0.5)
    if (nw < tw) nw = tw
    if (nh < th) nh = th
    print nw, nh
  }')"

  local tmp
  tmp="$(mktemp -t appstore-screenshot.XXXXXX).png"
  sips --resampleHeightWidth "$nh" "$nw" "$src" --out "$tmp" >/dev/null
  mkdir -p "$(dirname "$out")"
  sips --cropToHeightWidth "$th" "$tw" "$tmp" --out "$out" >/dev/null
  rm -f "$tmp" "${tmp%.png}"
}

ipad_source() {
  local theme="$1"
  local scene="$2"
  local full="$SRC_ROOT/ipad/$theme/${scene}.full.png"
  local web="$SRC_ROOT/ipad/$theme/${scene}.png"
  if [[ -f "$full" ]]; then
    echo "$full"
  else
    echo "$web"
  fi
}

for theme in light dark; do
  for i in "${!SCENES[@]}"; do
    scene="${SCENES[$i]}"
    name="${NAMES[$i]}"

    cover_resize \
      "$SRC_ROOT/iphone/$theme/${scene}.full.png" \
      "$OUT_ROOT/iphone-6.5/$theme/${name}.png" \
      "$IPHONE_W" "$IPHONE_H"

    cover_resize \
      "$(ipad_source "$theme" "$scene")" \
      "$OUT_ROOT/ipad-13/$theme/${name}.png" \
      "$IPAD_W" "$IPAD_H"
  done
done

echo "Wrote screenshots to $OUT_ROOT"
