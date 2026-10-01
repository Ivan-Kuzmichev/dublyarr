'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'input:not([type=hidden]), button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

type Props = { open: boolean; onClose: () => void; labelledBy: string; children: React.ReactNode; width?: number };

/** Desktop — модалка по центру; телефон — шторка снизу. Esc и клик по фону закрывают. */
export function Modal({ open, onClose, labelledBy, children, width = 880 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () =>
      Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => !el.hasAttribute('disabled'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab') return;
      // фокус не уходит за пределы окна
      const els = focusables();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ maxWidth: width }}
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[22px] border border-line bg-surface md:max-h-[90dvh] md:rounded-[24px]"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
