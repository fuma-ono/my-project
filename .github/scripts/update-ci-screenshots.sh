#!/usr/bin/env bash
# UI Screenshots の撮影結果を ci-screenshots/iPhone に反映する(HQ指示 2026-11-04「UI Screenshots workflow の安全対策」)。
#
#   update-ci-screenshots.sh <撮影結果のディレクトリ> <ci-screenshots/iPhone>
#
# 以前は反映先の *.png を全部消してからコピーしていたため、UIテストが取り消された run で撮影結果が空のまま
# この処理だけが走り、45枚すべてを消す commit(c7c0074c)ができた。ここでは:
#   - 撮影結果が無い・空なら、何も変えずに終わる(exit 0、反映先には触れない)。
#   - 一括削除はしない。画面ごと(ファイル名の「<画面名>_0_<UUID>.png」の画面名)に、新しく撮れた画面の
#     古いファイルだけを置き換える。今回撮れなかった画面のファイルは残す。
#   - 反映後の枚数が反映前より減っていたら、元に戻して失敗(exit 1)にする(念のための確認)。
# commit・push はこのスクリプトではしない(workflow の次の処理)。
set -euo pipefail

src="${1:?撮影結果のディレクトリ}"
dest="${2:?反映先のディレクトリ}"

shopt -s nullglob
new=("$src"/*.png)
if [ ! -d "$src" ] || [ "${#new[@]}" -eq 0 ]; then
  echo "No exported screenshots in $src; leaving $dest untouched."
  exit 0
fi

mkdir -p "$dest"
before=("$dest"/*.png)
backup="$(mktemp -d)"
cp -p "${before[@]}" "$backup"/ 2>/dev/null || true

screen_of() {
  local name
  name="$(basename "$1")"
  if [[ "$name" =~ ^(.+)_0_[0-9A-Fa-f-]{36}\.png$ ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo "${name%.png}"
  fi
}

for file in "${new[@]}"; do
  screen="$(screen_of "$file")"
  for old in "$dest"/*.png; do
    if [ "$(screen_of "$old")" = "$screen" ]; then
      rm -f "$old"
    fi
  done
  cp -p "$file" "$dest"/
done

after=("$dest"/*.png)
echo "Screenshots: before=${#before[@]} new=${#new[@]} after=${#after[@]}"
if [ "${#after[@]}" -lt "${#before[@]}" ]; then
  echo "::error::Screenshot count decreased (${#before[@]} -> ${#after[@]}); restoring and not committing."
  rm -f "$dest"/*.png
  cp -p "$backup"/*.png "$dest"/ 2>/dev/null || true
  rm -rf "$backup"
  exit 1
fi
rm -rf "$backup"
