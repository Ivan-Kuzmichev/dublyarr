import type { Db } from './db/client';
import { addSource, savedApiKey, updateSource } from './sources';
import { torznabCaps, torznabIndexers, TorznabError, type TorznabIndexer } from './torznab';
import { jacredCheck } from './jacred';
import { endpointFor, jackettBase } from './source-kinds';
import { markSourceTrackers, syncTrackers } from './trackers';
import type { SourceInput } from './source-form';

/** Проверить источник по его типу и сохранить (новый или правка); общий путь для настроек, мастера и API. */
export async function saveSource(
  db: Db,
  input: SourceInput,
  id: number | null,
  fetchImpl?: typeof fetch,
): Promise<{ ok: true; id: number; categories: number | null } | { error: string }> {
  const key = input.apiKey || (id ? savedApiKey(db, id) : '');
  // Jackett: вставленный адрес «все трекеры» храним базой — путь допишется при запросе
  const url = input.kind === 'jackett' ? (jackettBase(input.url) ?? input.url.replace(/\/+$/, '')) : input.url;
  const src = { kind: input.kind, url, apiKey: key, timeoutMs: input.timeoutMs };
  let indexers: TorznabIndexer[] | null = null;
  let categories: number | null = null;
  try {
    if (input.kind === 'jacred') await jacredCheck(src, { fetchImpl });
    else {
      const t = { ...src, url: endpointFor(src) };
      categories = (await torznabCaps(t, fetchImpl)).categories;
      indexers = await torznabIndexers(t, fetchImpl);
    }
  } catch (e) {
    return { error: e instanceof TorznabError ? e.message : `Источник не отвечает: ${e instanceof Error ? e.message : String(e)}` };
  }
  const sourceId = id ?? addSource(db, { ...input, url, apiKey: key }).id;
  if (id) updateSource(db, id, { ...input, url });
  if (indexers) syncTrackers(db, sourceId, indexers);
  markSourceTrackers(db, sourceId, null);
  return { ok: true, id: sourceId, categories };
}
