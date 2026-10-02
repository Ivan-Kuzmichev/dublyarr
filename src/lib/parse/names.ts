import { normalizeTitle } from './normalize';

// Пометка сезона/серий в начале части заголовка («S2E1-10 of 10», «E01-E28», «: 1-5», «Сезон: 2»).
const LEADING_MARKER = /^(?::\s*[\d\s-]+|S\d{1,2}(?:-\d{1,2})?E[\d-]+(?:\s+of\s+\S+)?|E\d{1,4}(?:\s*-\s*E?\d{1,4})?(?:\s+of\s+\S+)?|Сезоны?\s*:[^/]*|Сери[яи]\s*:[^/]*)\s*/i;
// Где кончается название внутри части.
const NAME_END = /(\s*\[|\s+-\s+|\s*\(\s*(?:HD|S\d|\d{3,4}p)|\s*\b[Ss]\d{1,2}(?:-\d{1,2})?[Ee]\d|\s+[Ss]\d{1,2}\b|\s+(?:19|20)\d{2}\b)/;

/** «Dogulwang (Toukutsu Ou, Tomb Raider King)» — три варианта; «Shameless (US)» — одно название (в скобках не названия). */
function variants(name: string): string[] {
  const m = /^(.+?)\s*\(([^()]+)\)$/.exec(name);
  if (!m) return [name];
  const inner = m[2].split(/\s*[,;]\s*/).filter((x) => /\p{L}{3,}/u.test(x) && !/^(?:19|20)\d{2}$/.test(x));
  return inner.length ? [m[1].trim(), ...inner] : [name];
}

/** Названия и год из заголовка раздачи. */
export function parseNames(title: string): { names: string[]; year: number | null } {
  const t = title.replace(/^\(S\d+\)\s*\/\s*/i, '').trim();
  const names: string[] = [];
  const rudub = /^(.+?)\s*\(([^()]+)\)\s*S\d/i.exec(t); // «Рус (Eng)S2E01-10»
  if (rudub) names.push(rudub[1].trim(), rudub[2].trim());
  else
    for (const part of t.split(' / ')) {
      const rest = part.trim().replace(LEADING_MARKER, '');
      const name = rest.split(NAME_END)[0].trim();
      if (name) names.push(...variants(name));
    }
  const seen = new Set<string>();
  const unique = names.filter((n) => {
    const k = normalizeTitle(n);
    return k && !seen.has(k) && seen.add(k);
  });
  const year = /\[((?:19|20)\d{2})(?:-\d{4})?,/.exec(title)?.[1] ?? / - ((?:19|20)\d{2})(?:-\d{4})?(?:\s|$)/.exec(title)?.[1];
  return { names: unique, year: year ? Number(year) : null };
}

/** Основа заголовка для правил «это он / не он»: первое название, нормализованное. */
export function baseOf(title: string): string {
  return normalizeTitle(parseNames(title).names[0] ?? title);
}
