import pkg from '../../package.json';

/** Версия Dublyarr: из образа (сборка по тегу), иначе — из package.json; edge/dev — с пометкой. */
export function appVersion() {
  const env = process.env.DUBLYARR_VERSION;
  if (!env) return pkg.version;
  return /^\d+\.\d+\.\d+/.test(env) ? env : `${pkg.version} (${env})`;
}
