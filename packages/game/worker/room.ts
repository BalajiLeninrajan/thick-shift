// The rooms, shared by every app's Worker. /room/CODE is a WebSocket into that room's Durable Object, which runs the
// night: it takes what every guard's browser sends (commandFloor), steps the night ten times a second and sends the
// whole state to everyone in the room. No browser runs a room's night, so one slow tab or connection holds up only
// its own guard. An app's Worker hands requests to toRoom() and exports Room as its Durable Object.
import { DurableObject } from 'cloudflare:workers';
import { adoptFloor, commandFloor, joinFloor, leaveFloor, newSim, newState, type Sim, stepFloor } from '@thick-shift/sim';
import type { CloseCode, Player, State, StateMessage } from '@thick-shift/sim/types';
import { CLOSE, type Mode, PROTOCOL, parse, TICK_MS } from '../src/protocol';

const SAVE_TICKS = 20; // how often a night in play is saved, in ticks: every 2 s
const FORGET_MS = 5 * 60_000; // how long a room with nobody in it keeps its night, for guards who lost their connection
// How long a guard whose connection dropped mid-night stays in it, still standing (or still flat) where they were,
// before the room takes them out. Longer than a page spends reconnecting (RETRY_MS in src/net.ts).
const GRACE_MS = 20_000;
const MAX_MESSAGE = 2000; // characters. A guard's commands are tiny.

// A room is a four-letter code someone typed, or a lowercase letter, a dash and an id that an app gets from its
// platform, such as d- and a Discord Activity's instance id (apps/discord).
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

// The ids net.ts makes up (newId): a g and lowercase letters and digits. Nothing that could name an Object property.
const GUARD_ID = /^g[a-z0-9]{8,40}$/;
const isPosition = (c: unknown): boolean => typeof c === 'object' && c !== null && 't' in c && c.t === 'p';

// One instance per room code. Between nights nothing runs, so the object can sleep, and S is saved whenever it changes
// so a fresh instance picks up where it left off. A night in play runs on a timer and is saved every SAVE_TICKS. A
// fresh instance (after a deploy, say) makes the mascots' thinking up from S (adoptFloor).
export class Room extends DurableObject<RoomEnv> {
  night: { sim: Sim; S: State } | null = null;
  // Guards whose connection dropped during this night, and when the room takes them out of it. Until then they are
  // still in the night, so a flat guard who gets back first does not end it for a crew that is still reconnecting.
  lost = new Map<string, number>();
  // Guards out of this night, with their records, so one who comes back later is where they were and as flat as they
  // were. Saved with S. A new night clears it, since startFloorNight places everyone afresh.
  away = new Map<string, Player>();
  loop: ReturnType<typeof setInterval> | null = null;
  ticks = 0;

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    const S = ctx.storage.kv.get<State>('S');
    if (S) this.restore(S, ctx.storage.kv.get<Player[]>('away') ?? []);
  }

  // The night as storage has it, with whoever is still connected (the object woke from sleep) or nobody yet (it was
  // restarted, and the guards come back as their pages reconnect). Mid-night, everyone the saved night had stays in it
  // as lost until they are back or GRACE_MS runs out.
  restore(S: State, away: Player[]): void {
    const now = Date.now(),
      sim = newSim({ rng: Math.random, now });
    this.night = { sim, S };
    this.away = new Map(away.map(p => [p.id, p]));
    this.lost.clear();
    // Pages have seen events numbered past the last save, so number the new ones after anything they can have seen.
    S.evId += 1000;
    for (const p of S.players)
      if (S.phase === 'play') {
        sim.players[p.id] = p;
        this.lost.set(p.id, now + GRACE_MS);
      } else this.away.set(p.id, p);
    S.players = Object.values(sim.players);
    if (S.phase === 'play') adoptFloor(sim, S, now);
    for (const ws of this.open()) this.enter(att(ws).id);
    if (this.open().length) this.run();
  }

  open(): WebSocket[] {
    return this.ctx.getWebSockets().filter(s => s.readyState === WebSocket.READY_STATE_OPEN && !att(s).gone);
  }

  enter(id: string): void {
    if (!this.night) return;
    this.lost.delete(id);
    joinFloor(this.night.sim, this.night.S, id, this.away.get(id));
    this.away.delete(id);
  }

  // Take a guard out of the night, keeping their record for when they come back.
  out(id: string): void {
    if (!this.night) return;
    const record = this.night.sim.players[id];
    if (record) this.away.set(id, record);
    this.lost.delete(id);
    leaveFloor(this.night.sim, this.night.S, id);
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
    if (q.get('v') !== String(PROTOCOL)) return refuse(CLOSE.OUTDATED, 'reload for the new version');
    if (!isMode(mode) || !GUARD_ID.test(id)) return refuse(CLOSE.BAD, 'bad id or mode');
    const socks = this.open(),
      mine = socks.filter(s => att(s).id === id),
      others = socks.length - mine.length;
    if (mode === 'make' && others) return refuse(CLOSE.CODE_TAKEN, 'room code in use');
    if (mode === 'join' && !this.night) return refuse(CLOSE.NO_ROOM, 'no such room');
    // A new night: nobody has one here, or someone starting a room under a code whose night everyone has left.
    if (!this.night || (mode === 'make' && !others)) {
      this.stop();
      this.night = { sim: newSim({ rng: Math.random, now: Date.now() }), S: newState(url.pathname.match(ROOM)?.[1] ?? '') };
      this.away.clear();
      this.lost.clear();
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
    // The alarm stays set for as long as the room has a night, so it also fires for one whose instance died.
    this.ctx.storage.kv.delete('empty');
    void this.ctx.storage.setAlarm(Date.now() + FORGET_MS);
    this.changed();
    if (this.night.S.phase === 'play') this.run();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): void {
    if (typeof msg !== 'string' || msg.length > MAX_MESSAGE || !this.night) return;
    const { sim, S } = this.night,
      c = parse(msg);
    if (commandFloor(sim, S, att(ws).id, c)) {
      this.away.clear();
      this.changed();
    }
    // A night in play goes out on the next tick. Between nights, anything but a position goes out now.
    if (S.phase === 'play') this.run();
    else if (!isPosition(c)) this.changed();
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
    // Mid-night they may only have lost their connection: give them a while to get back (lost). Between nights, out.
    if (this.night.S.phase === 'play' && this.night.sim.players[a.id]) this.lost.set(a.id, Date.now() + GRACE_MS);
    else this.out(a.id);
    if (this.open().length) {
      this.changed();
      return;
    }
    // Nobody is left. Stop running the night, and keep it a while in case they lost their connection.
    this.stop();
    void this.save();
    void this.ctx.storage.setAlarm(Date.now() + FORGET_MS);
  }

  // Nobody here on two looks in a row: let the night go. The second look, GRACE_MS on, is for a room restarted a
  // moment before the first, whose pages are still on their way back.
  async alarm(): Promise<void> {
    const empty = !this.open().length;
    if (!empty || !this.ctx.storage.kv.get('empty')) {
      this.ctx.storage.kv.put('empty', empty);
      await this.ctx.storage.setAlarm(Date.now() + (empty ? GRACE_MS : FORGET_MS));
      return;
    }
    this.stop();
    this.night = null;
    this.away.clear();
    this.lost.clear();
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
    const now = Date.now();
    for (const [id, until] of this.lost) if (now > until) this.out(id);
    stepFloor(night.sim, night.S, now);
    this.send();
    if (night.S.phase !== 'play') {
      // The night is over, so anyone still lost is out of it.
      for (const id of this.lost.keys()) this.out(id);
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
    return this.ctx.storage.put({ S: this.night.S, away: [...this.away.values()] }, { allowUnconfirmed: true });
  }
}
