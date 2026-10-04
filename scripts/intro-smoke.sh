#!/bin/sh
# Проверка разметки в образе: docker run --rm --entrypoint sh dublyarr:dev scripts/intro-smoke.sh
set -e
dir=$(mktemp -d)
mkdir -p "$dir/media/Show (2020)/Season 01"
# «музыка»: мелодия из тонов, меняющихся каждые 1/3 с; у каждой серии и у опенинга — своя (шум не годится: его отпечатки почти одинаковы везде)
tune() { echo "0.4*sin(2*PI*t*(220+37*mod(floor(t*3)*$1\\,17)))+0.3*sin(2*PI*t*(330+23*mod(floor(t*2)*($1+3)\\,11)))"; }
ffmpeg -v error -f lavfi -i "aevalsrc=$(tune 101):s=44100:d=30" "$dir/op.wav"
i=1
for at in 20 45 70; do
  ffmpeg -v error -f lavfi -i "aevalsrc=$(tune $((i*7+1))):s=44100:d=$at" -i "$dir/op.wav" -f lavfi -i "aevalsrc=$(tune $((i*13+50))):s=44100:d=200" \
    -f lavfi -i testsrc=duration=$((at+230)):size=160x120:rate=5 \
    -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]" -map 3:v -map "[a]" -c:v libx264 -c:a aac -shortest \
    "$dir/media/Show (2020)/Season 01/Show S01E0$i.mkv"
  i=$((i+1))
done
DATA_DIR="$dir/data" node dist/intro-smoke.cjs "$dir/media"
