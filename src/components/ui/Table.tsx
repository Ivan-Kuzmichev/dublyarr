type Column<R> = { key: string; label: string; width?: string; render: (row: R) => React.ReactNode };

/** Таблица из макетов настроек; на узком экране строки становятся карточками «подпись: значение». */
export function Table<R>({ columns, rows, rowKey }: { columns: Column<R>[]; rows: R[]; rowKey: (r: R) => string | number }) {
  const grid = { gridTemplateColumns: columns.map((c) => c.width ?? 'minmax(0, 1fr)').join(' ') };
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="hidden gap-3.5 bg-surface px-[18px] py-3 text-[11px] font-semibold tracking-[0.06em] text-faint uppercase md:grid" style={grid}>
        {columns.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div
          key={rowKey(r)}
          className={`flex flex-col gap-1.5 px-4 py-3 text-sm md:grid md:items-center md:gap-3.5 md:px-[18px] ${i > 0 ? 'border-t border-line-soft' : 'md:border-t md:border-line-soft'}`}
          style={grid}
        >
          {columns.map((c) => (
            <div key={c.key} className="flex gap-2 md:block">
              <span className="w-28 shrink-0 text-[13px] text-faint md:hidden">{c.label}</span>
              <span className="min-w-0">{c.render(r)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
