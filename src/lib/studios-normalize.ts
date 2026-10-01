/** Форма для сравнения написаний студий: регистр, ё/е, пробелы, точки, дефисы и подчёркивания не важны. */
export const normalizeStudio = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s.\-_]+/g, '');
