// The web game's Worker: the rooms and nothing else. The game itself is the built static files, served
// before this code runs.
import { type RoomEnv, toRoom } from '@thick-shift/game/worker';

export { Room } from '@thick-shift/game/worker';

export default { fetch: toRoom } satisfies ExportedHandler<RoomEnv>;
