export const restartDelay = (failuresInRow: number) => Math.min(1000 * 2 ** failuresInRow, 30_000);
/** Проработал минуту — считаем, что поднялся нормально, и сбрасываем счётчик падений. */
export const shouldResetFailures = (uptimeMs: number) => uptimeMs >= 60_000;
