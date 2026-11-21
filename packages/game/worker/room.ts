// The rooms, shared by every app's Worker. /room/CODE is a WebSocket into that room's Durable Object, which runs the
// night: it takes what every guard's browser sends (commandFloor), steps the night ten times a second and sends the
// whole state to everyone in the room. No browser runs a room's night, so one slow tab or connection holds up only
// its own guard. An app's Worker hands requests to toRoom() and exports Room as its Durable Object.
import { DurableObject } from 'cloudflare:workers';
import { adoptFloor, commandFloor, joinFloor, leaveFloor, newSim, newState, type Sim, stepFloor } from '@thick-shift/sim';
import type { CloseCode, Player, State, StateMessage } from '@thick-shift/sim/types';

const TICK_MS = 100;
const SAVE_TICKS = 20; // how often a night in play is saved, in ticks: every 2 s
const FORGET_MS = 5 * 60_000; // how long a room with nobody in it keeps its night, for guards who lost their connection
const MAX_MESSAGE = 2000; // characters. A guard's commands are tiny.
// The room's half of the protocol with src/net.ts. A page from a build that speaks another is told to reload.
const PROTOCOL = '2';
const NO_ROOM = 4404,
  CODE_TAKEN = 4409,
  OUTDATED = 4426;

// A room is a four-letter code someone typed, or a lowercase letter, a dash and an id that an app gets from its
// platform, such as d- and a Discord Activity's instance id (apps/discord). Matches ROOM in src/net.ts.
const ROOM = /^\/room\/([A-Z]{4}|[a-z]-[\w-]{1,80})$/;

// The bindings toRoom() needs from an app's Worker (its wrangler.jsonc).
export interface RoomEnv {
  ROOMS: DurableObjectNamespace;
}

export function toRoom(req: Request, env: RoomEnv): Promise<Response> | Response {
  const code = new URL(req.url).pathname.match(ROOM)?.[1];
  if (!code || req.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
  return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
}

// How a page comes into a room (?mode= from net.ts): make a new one under a code nobody is using, join one that has a
// night, or either, for a room an app fixes (everyone in a Discord channel opens the same one) and for a guard coming
// back after losing their connection.
type Mode = 'make' | 'join' | 'either';
const isMode = (m: string | null): m is Mode => m === 'make' || m === 'join' || m === 'either';

// Each socket's guard, kept on the socket so it outlasts the object sleeping between nights (hibernation). gone: its
// leaving has been handled, or the same guard came back on a new socket before the room saw this one close.
interface Attachment {
  id: string;
  gone?: boolean;
}
function att(ws: WebSocket): Attachment {
  const a: Attachment | null = ws.deserializeAttachment(); // typed any
  if (!a) throw new Error('a room socket has no attachment');
  return a;
}
const OPEN = 1;

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const isPosition = (c: unknown): boolean => typeof c === 'object' && c !== null && 't' in c && c.t === 'p';

// One instance per room code. Between nights nothing runs, so the object can sleep, and S is saved whenever it changes
// so a fresh instance picks up where it left off. A night in play runs on a timer and is saved every SAVE_TICKS. A
// fresh instance (after a deploy, say) makes the mascots' thinking up from S (adoptFloor).
export class Room extends DurableObject<RoomEnv> {
  night: { sim: Sim; S: State } | null = null;
  // Guards a restored night had who have not come back yet, with their records, so they come back where they were.
  away = new Map<string, Player>();
  loop: ReturnType<typeof setInterval> | null = null;
  ticks = 0;

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const S = await ctx.storage.get<State>('S');
      if (S) this.restore(S);
    });
  }

  // The night as storage has it, with whoever is still connected (the object woke from sleep) or nobody yet (it was
  // restarted, and the guards come back as their pages reconnect).
  restore(S: State): void {
    const now = Date.now(),
      sim = newSim({ rng: Math.random, now });
    this.night = { sim, S };
    if (S.phase === 'play') adoptFloor(sim, S, now);
    this.away = new Map(S.players.map(p => [p.id, p]));
    S.players = [];
    for (const ws of this.open()) this.enter(att(ws).id);
    if (this.open().length) this.run();
    else void this.ctx.storage.setAlarm(now + FORGET_MS);
  }

  open(): WebSocket[] {
    return this.ctx.getWebSockets().filter(s => s.readyState === OPEN && !att(s).gone);
  }

  enter(id: string): void {
    if (!this.night) return;
    joinFloor(this.night.sim, this.night.S, id, this.away.get(id));
    this.away.delete(id);
  }

  fetch(req: Request): Response {
    const url = new URL(req.url),
      q = url.searchParams,
      id = q.get('id') ?? '',
      mode = q.get('mode');
    const { 0: client, 1: server } = new WebSocketPair();
    // A refused socket is still accepted first, so the browser sees the close code.
    const refuse = (code: CloseCode, why: string): Response => {
      server.accept();
      server.close(code, why);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (q.get('v') !== PROTOCOL) return refuse(OUTDATED, 'reload for the new version');
    if (!isMode(mode) || !/^[\w-]{1,40}$/.test(id)) return refuse(1008, 'bad id or mode');
    const mine = this.open().filter(s => att(s).id === id),
      others = this.open().length - mine.length;
    if (mode === 'make' && others) return refuse(CODE_TAKEN, 'room code in use');
    if (mode === 'join' && !this.night) return refuse(NO_ROOM, 'no such room');
    // A new night: nobody has one here, or someone starting a room under a code whose night everyone has left.
    if (!this.night || (mode === 'make' && !others)) {
      this.stop();
      this.night = { sim: newSim({ rng: Math.random, now: Date.now() }), S: newState(url.pathname.match(ROOM)?.[1] ?? '') };
      this.away.clear();
    }
    // The same guard on an older socket the room has not seen close: the new one takes over, and they stay in the night.
    for (const old of mine) {
      old.serializeAttachment({ ...att(old), gone: true });
      try {
        old.close(1000, 'reconnected');
      } catch {
        /* already closing */
      }
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id } satisfies Attachment);
    this.enter(id);
    void this.ctx.storage.deleteAlarm();
    this.changed();
    if (this.night.S.phase === 'play') this.run();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    if (typeof msg !== 'string' || msg.length > MAX_MESSAGE || !this.night) return;
    const { sim, S } = this.night,
      c = parse(msg),
      was = S.phase;
    commandFloor(sim, S, att(ws).id, c);
    // A night in play goes out on the next tick. Between nights, anything but a position goes out now.
    if (S.phase === 'play') {
      if (was !== 'play') this.changed();
      this.run();
    } else if (!isPosition(c)) this.changed();
  }

  webSocketClose(ws: WebSocket): void {
    this.left(ws);
  }
  webSocketError(ws: WebSocket): void {
    this.left(ws);
  }

  left(ws: WebSocket): void {
    const a = att(ws);
    if (a.gone) return; // an error and a close can both arrive for one socket, and a replaced one was handled
    ws.serializeAttachment({ ...a, gone: true });
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    if (!this.night) return;
    leaveFloor(this.night.sim, this.night.S, a.id);
    if (this.open().length) {
      this.changed();
      return;
    }
    // Nobody is left. Stop running the night, and keep it a while in case they lost their connection.
    this.stop();
    void this.save();
    void this.ctx.storage.setAlarm(Date.now() + FORGET_MS);
  }

  // Still nobody here: let the night go.
  async alarm(): Promise<void> {
    if (this.open().length) return;
    this.stop();
    this.night = null;
    this.away.clear();
    await this.ctx.storage.deleteAll();
  }

  /* ---------- the night ---------- */

  run(): void {
    this.loop ??= setInterval(() => this.tick(), TICK_MS);
  }
  stop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  tick(): void {
    const night = this.night;
    if (!night || !this.open().length) {
      this.stop();
      return;
    }
    stepFloor(night.sim, night.S, Date.now());
    this.send();
    if (night.S.phase !== 'play') {
      this.stop();
      void this.save();
    } else if (++this.ticks % SAVE_TICKS === 0) void this.save();
  }

  // S changed between ticks: send it and save it.
  changed(): void {
    this.send();
    void this.save();
  }

  send(): void {
    if (!this.night) return;
    const msg = JSON.stringify({ t: 's', s: this.night.S } satisfies StateMessage);
    for (const ws of this.open())
      try {
        ws.send(msg);
      } catch {
        /* closing */
      }
  }

  // allowUnconfirmed: the state goes out without waiting for the write. Losing the last save to a crash costs two
  // seconds of night, which is cheaper than holding every send behind the disk.
  save(): Promise<void> {
    if (!this.night) return Promise.resolve();
    return this.ctx.storage.put('S', this.night.S, { allowUnconfirmed: true });
  }
}
