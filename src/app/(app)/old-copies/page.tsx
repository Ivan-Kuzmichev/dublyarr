import { eq } from 'drizzle-orm';
import { PageTitle } from '@/components/shell/PageTitle';
import { Card } from '@/components/ui/Card';
import { getDb } from '@/lib/db/client';
import { oldCopies, titles } from '@/lib/db/schema';
import { OldCopiesForm } from './OldCopiesForm';

export const metadata = { title: 'Старые копии · Dublyarr' };
export const dynamic = 'force-dynamic';

const pad = (n: number) => String(n).padStart(2, '0');

export default function OldCopiesPage() {
  const rows = getDb()
    .select({ c: oldCopies, title: titles.nameRu })
    .from(oldCopies)
    .innerJoin(titles, eq(titles.id, oldCopies.titleId))
    .all()
    .map(({ c, title }) => ({ id: c.id, title, code: `S${pad(c.season)}E${pad(c.number)}`, reason: c.reason, size: c.size }));
  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <span className="text-sm text-muted">Правило хранения · первое срабатывание</span>
        <PageTitle>Старые копии</PageTitle>
      </div>
      <p className="m-0 text-[15px] leading-relaxed text-text-2">
        Эти серии заменены на лучшую озвучку или качество. Прежние копии убраны из медиатеки в скрытую папку и ждут вашего решения.
      </p>
      {rows.length ? (
        <OldCopiesForm rows={rows} />
      ) : (
        <Card>
          <p className="m-0 text-[15px] text-muted">Старых копий нет.</p>
        </Card>
      )}
    </div>
  );
}
