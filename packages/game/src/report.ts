// Reports from the page to its Worker's logs (POST /api/report, worker/room.ts), for bugs that only show up on someone
// else's machine, such as inside Discord, where there is no console to read. The Worker writes each one to Workers
// Logs. Uncaught errors and rejected promises are reported, as is anything passed to report(). A page sends at most
// MAX, so an error thrown every frame does not flood the logs.

const MAX = 20;
let sent = 0;

// kind: a short name for what happened. detail: anything that says more, kept small.
export function report(kind: string, detail: Record<string, unknown> = {}): void {
  if (sent >= MAX) return;
  sent++;
  const body = JSON.stringify({ kind, ...detail, ua: navigator.userAgent, at: Math.round(performance.now()) });
  try {
    navigator.sendBeacon('/api/report', new Blob([body], { type: 'application/json' }));
  } catch {
    /* no beacon here: nothing else to try */
  }
}

// Report every error nothing caught. Called once, by start() in main.ts.
export function reportErrors(): void {
  addEventListener('error', e =>
    report('error', { message: e.message, where: `${e.filename}:${e.lineno}:${e.colno}`, stack: String(e.error?.stack ?? '').slice(0, 800) })
  );
  addEventListener('unhandledrejection', e =>
    report('rejection', { message: String(e.reason?.message ?? e.reason).slice(0, 300), stack: String(e.reason?.stack ?? '').slice(0, 800) })
  );
}
