// The web game's Worker: the room relay and nothing else. The game itself is the built static files, served
// before this code runs.
import { type RelayEnv, relay } from '@thick-shift/game/worker';
export { Room } from '@thick-shift/game/worker';

export default { fetch: relay } satisfies ExportedHandler<RelayEnv>;
