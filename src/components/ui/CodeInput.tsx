'use client';

import { useEffect, useRef, useState } from 'react';

type Props = { name: string; onComplete?: (code: string) => void; autoFocus?: boolean; label?: string };

/**
 * Шесть ячеек для кода из приложения. Вставка или автозаполнение целого кода в любую ячейку
 * раскладывается по ячейкам; полный код уходит в форму скрытым полем `name`.
 */
export function CodeInput({ name, onComplete, autoFocus, label = 'Код из приложения' }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = digits.join('');

  // После рендера: скрытое поле уже содержит полный код, форму можно отправлять.
  useEffect(() => {
    if (code.length === 6) onComplete?.(code);
  }, [code, onComplete]);

  function put(from: number, raw: string) {
    const incoming = raw.replace(/\D/g, '').slice(0, 6 - from).split('');
    if (!incoming.length) return;
    const next = [...digits];
    incoming.forEach((d, i) => (next[from + i] = d));
    setDigits(next);
    const last = Math.min(from + incoming.length, 5);
    refs.current[last]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      const next = [...digits];
      next[i - 1] = '';
      setDigits(next);
      refs.current[i - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  }

  return (
    <div role="group" aria-label="Шесть цифр кода" className="flex justify-between gap-2">
      <input type="hidden" name={name} value={code} />
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          aria-label={i === 0 ? label : `Цифра ${i + 1}`}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') {
              const next = [...digits];
              next[i] = '';
              setDigits(next);
            } else put(i, v.length > 1 && d ? v.replace(d, '') || v : v);
          }}
          onPaste={(e) => {
            e.preventDefault();
            put(0, e.clipboardData.getData('text'));
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className="box-border h-[67px] w-0 min-w-0 flex-1 rounded-xl border border-field-line bg-surface text-center font-mono text-[26px] text-text outline-none focus:border-2 focus:border-accent sm:w-14 sm:flex-none"
        />
      ))}
    </div>
  );
}
