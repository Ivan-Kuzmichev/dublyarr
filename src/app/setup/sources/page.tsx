import { getDb } from '@/lib/db/client';
import { listSources } from '@/lib/sources';
import { Steps, StepHeading } from '../Steps';
import { requireSetupSession } from '../guard';
import { removeSourceAction } from '../actions';
import { SourceForm } from './SourceForm';

export default async function SetupSourcesPage() {
  await requireSetupSession();
  const sources = listSources(getDb());
  return (
    <>
      <Steps current="sources" />
      <StepHeading title="Источники">
        Любой Torznab: Jackett или Prowlarr. Источников может быть несколько — их опрашивают параллельно.
      </StepHeading>
      {sources.length > 0 && (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl border border-line bg-surface p-0">
          {sources.map((s, i) => (
            <li key={s.id} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t border-line-soft' : ''}`}>
              <span className="flex min-w-0 grow flex-col gap-1">
                <span className="text-[15px] font-semibold">{s.name}</span>
                <span className="truncate font-mono text-xs text-faint">{s.url}</span>
              </span>
              <form action={removeSourceAction}>
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" className="h-11 cursor-pointer px-2 text-sm text-muted hover:text-danger">
                  Удалить
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <SourceForm hasSources={sources.length > 0} />
    </>
  );
}
