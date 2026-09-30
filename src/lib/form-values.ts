/**
 * React 19 сбрасывает форму после server action. Действие возвращает то, что ввёл пользователь,
 * а форма подставляет это в defaultValue. Список полей явный — пароли и ключи обратно не уходят.
 */
export function formValues(form: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, String(form.get(k) ?? '').trim()]));
}
