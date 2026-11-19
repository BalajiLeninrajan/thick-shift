// The web game's Worker: the room relay and nothing else. The game itself is the static files in
// packages/game/public, served before this code runs.
import { relay } from '@thick-shift/game/worker';
export { Room } from '@thick-shift/game/worker';

export default { fetch: relay };
