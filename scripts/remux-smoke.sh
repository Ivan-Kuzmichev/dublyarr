#!/bin/sh
# Проверка пересборки в образе: docker run --rm --entrypoint sh dublyarr:dev scripts/remux-smoke.sh
set -e
dir=$(mktemp -d)
printf '1\n00:00:00,000 --> 00:00:01,500\nНадпись\n' > "$dir/forced.srt"
printf '1\n00:00:00,000 --> 00:00:01,500\nПолный текст\n' > "$dir/full.srt"
ffmpeg -v error -f lavfi -i testsrc=duration=2:size=320x240:rate=25 \
  -f lavfi -i sine=frequency=440:duration=2 -f lavfi -i sine=frequency=550:duration=2 -f lavfi -i sine=frequency=660:duration=2 \
  -i "$dir/forced.srt" -i "$dir/full.srt" \
  -map 0:v -map 1:a -map 2:a -map 3:a -map 4 -map 5 -c:v libx264 -c:a aac -c:s srt \
  -metadata:s:a:0 language=eng -metadata:s:a:0 title=Original \
  -metadata:s:a:1 language=rus -metadata:s:a:1 "title=HDrezka Studio" \
  -metadata:s:a:2 language=rus -metadata:s:a:2 title=LostFilm \
  -metadata:s:s:0 language=rus -metadata:s:s:0 title=Forced -disposition:s:0 forced \
  -metadata:s:s:1 language=rus -metadata:s:s:1 title=Full -disposition:s:1 0 \
  -disposition:a:0 default -disposition:a:1 0 -disposition:a:2 0 \
  "$dir/in.mkv"
node dist/remux-smoke.cjs "$dir/in.mkv" "$dir"
