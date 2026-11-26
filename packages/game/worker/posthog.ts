// What the rooms tell PostHog: a few events a night, and any error they hit. Posted straight to the capture API, so
// the Worker carries no SDK. A Worker whose env has no POSTHOG_KEY (local dev, tests) sends nothing.

// The balajileninrajan.dev project, which every site shares and tells apart by $host.
const INGEST = 'https://us.i.posthog.com/i/v0/e/';

export interface PostHogEnv {
  POSTHOG_KEY?: string; // the project's phc_ token, which is public
}

type Properties = Record<string, unknown>;

// distinct_id: a room's Durable Object id. The rooms are not people, so PostHog makes no person profile for them.
export function capture(env: PostHogEnv, distinctId: string, event: string, properties: Properties): Promise<void> {
  const key = env.POSTHOG_KEY;
  if (!key) return Promise.resolve();
  const body = {
    api_key: key,
    event,
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: { ...properties, $process_person_profile: false },
  };
  return fetch(INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(
    () => undefined,
    () => undefined // losing an event is fine; failing the room over one is not
  );
}

// An error, as PostHog's Error Tracking reads it. The stack goes in raw, so the issue page shows where it came from.
export function captureException(env: PostHogEnv, distinctId: string, e: unknown, properties: Properties): Promise<void> {
  const err = e instanceof Error ? e : new Error(String(e));
  return capture(env, distinctId, '$exception', {
    ...properties,
    $exception_list: [{ type: err.name, value: err.message, mechanism: { handled: false, synthetic: false } }],
    stack: err.stack,
  });
}
