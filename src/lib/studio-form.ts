import type { StudioInput } from './studios';

const list = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function parseStudioForm(form: FormData): StudioInput | { error: string } {
  const kind = form.get('kind');
  if (kind !== 'series' && kind !== 'anime' && kind !== 'both') return { error: 'Выберите тип' };
  return { name: String(form.get('name') ?? ''), aliases: list(form.get('aliases')), kind, trackers: list(form.get('trackers')) };
}
