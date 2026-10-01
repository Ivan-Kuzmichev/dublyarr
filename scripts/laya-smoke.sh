#!/bin/sh
# Проверка Laya в образе: скачать модель (если её нет), задать вопросы по-русски, замерить время.
# docker run --rm -v /path/data:/data --entrypoint sh dublyarr:dev scripts/laya-smoke.sh
set -e
PORT=8799
LAYA_DIR=${LAYA_DIR:-/data/laya} /opt/laya/bin/python laya/serve.py --port $PORT &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
node -e "
const base = 'http://127.0.0.1:$PORT';
const wait = async () => {
  for (let i = 0; i < 2400; i++) {
    const h = await fetch(base + '/health').then((r) => r.json()).catch(() => null);
    if (h?.status === 'ready') return h;
    if (h?.status === 'error') throw new Error(h.error);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('модель не загрузилась за 40 минут');
};
const ask = (state, questions) => fetch(base + '/ask', { method: 'POST', body: JSON.stringify({ state, questions }) }).then((r) => r.json());
(async () => {
  const h = await wait();
  console.log('health', JSON.stringify(h));
  const st = { сериал: 'Дэдлок (2023), сезонов 2', раздача: 'Deadloch.S02E05.1080p.WEB-DL.Jaskier' };
  const q = { match: { type: 'noul', instructions: 'Эта раздача — тот же сериал?' }, studio: { type: 'choice', instructions: 'Какая студия озвучила раздачу?', criteria: { LostFilm: 'LostFilm', Jaskier: 'Jaskier', новая: 'студии нет в списке' } } };
  const times = [];
  let r;
  for (let i = 0; i < 5; i++) { r = await ask(st, q); times.push(r.ms); }
  console.log('answers', JSON.stringify(r.answers));
  if (typeof r.answers.match?.noul !== 'number' || !r.answers.studio?.choice) throw new Error('неполный ответ');
  console.log('ms', times.join(' '));
  console.log('laya smoke: OK');
})().catch((e) => { console.error('laya smoke: FAIL', e.message); process.exit(1); });
"
