/** JSON запроса API → FormData, чтобы разбирать тем же кодом, что формы: массив — несколько значений, true — «on», объект — JSON. */
export function toFormData(o: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o ?? {}))
    for (const x of Array.isArray(v) ? v : [v]) {
      if (x === undefined || x === null || x === false) continue;
      f.append(k, x === true ? 'on' : typeof x === 'object' ? JSON.stringify(x) : String(x));
    }
  return f;
}
