const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

// Largest delay setInterval accepts (about 24.8 days).
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * Keeps the process alive until it receives SIGINT (Ctrl+C) or SIGTERM (docker stop),
 * then resolves with the signal so the caller can close its resources.
 */
export function waitForShutdown(
  signals: readonly NodeJS.Signals[] = SHUTDOWN_SIGNALS,
): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    // Signal listeners alone do not keep Node running. Until pg-boss holds
    // open database connections, this timer keeps the event loop busy.
    const keepAlive = setInterval(() => undefined, MAX_TIMER_DELAY_MS);

    // One listener per signal, so each knows which signal it handles without
    // relying on the argument Node passes (process.emit in tests passes none).
    const listeners = signals.map((signal) => {
      const listener = (): void => {
        clearInterval(keepAlive);
        for (const [s, l] of listeners) process.off(s, l);
        resolve(signal);
      };
      return [signal, listener] as const;
    });

    for (const [s, l] of listeners) process.on(s, l);
  });
}
