import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  intentAckSchema,
  playerViewSchema,
  roomJoinedAckSchema,
  roomViewSchema,
  sessionResumedAckSchema,
} from './adapters/inbound/websocket/protocol';
import type { PlayerView } from './application/projection/player-view';
import type { RoomView } from './application/projection/room-view';
import type { GameEventBatch } from './application/ports/outbound/game-broadcaster.port';
import { buildDeck } from './domain/cards/deck';
import { NO_SPECIAL_RULES, type GameConfig } from './domain/config/game-config';
import { deal } from './domain/rules/deal';
import { createBinokelServer, type BinokelServer, type ServerOverrides } from './server';
import { identityShuffler } from './test/fakes';

const config: GameConfig = {
  playerCount: 3,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

const ACK_TIMEOUT_MS = 2_000;

interface TestClient {
  readonly socket: Socket;
  emit(event: string, ...args: unknown[]): Promise<unknown>;
  /** Wartet auf eine passende Nachricht, auch wenn sie schon eingetroffen ist. */
  waitFor<T>(event: string, predicate?: (payload: T) => boolean): Promise<T>;
}

let server: BinokelServer;
let url: string;
const clients: Socket[] = [];

async function start(overrides: ServerOverrides = {}): Promise<void> {
  server = createBinokelServer({ corsOrigins: '*' }, { shuffler: identityShuffler, ...overrides });
  url = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`;
}

async function client(): Promise<TestClient> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(socket);
  const received: [string, unknown][] = [];
  const waiting = new Set<() => void>();
  socket.onAny((event: string, payload: unknown) => {
    received.push([event, payload]);
    waiting.forEach((check) => check());
  });
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));

  return {
    socket,
    emit: (event, ...args) => socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, ...args),
    waitFor<T>(event: string, predicate: (payload: T) => boolean = () => true) {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(check);
          reject(new Error(`Keine passende Nachricht ${event}`));
        }, ACK_TIMEOUT_MS);
        function check() {
          const match = received.find(
            ([name, payload]) => name === event && predicate(payload as T),
          );
          if (match === undefined) return;
          clearTimeout(timer);
          waiting.delete(check);
          resolve(match[1] as T);
        }
        waiting.add(check);
        check();
      });
    },
  };
}

/** Anna erstellt, Ben und Cem treten bei; danach läuft das Reizen. */
async function fullRoom() {
  const anna = await client();
  const created = roomJoinedAckSchema.parse(
    await anna.emit('room:create', {
      displayName: 'Anna',
      config: { playerCount: 3, deckSize: 40 },
    }),
  );
  if (!created.ok) throw new Error(created.error.code);
  const players = [anna];
  const sessions = [created.sessionId];
  for (const displayName of ['Ben', 'Cem']) {
    const player = await client();
    const joined = roomJoinedAckSchema.parse(
      await player.emit('room:join', { roomId: created.roomId.toLowerCase(), displayName }),
    );
    if (!joined.ok) throw new Error(joined.error.code);
    players.push(player);
    sessions.push(joined.sessionId);
  }
  return { roomId: created.roomId, players, sessions };
}

const stateWith = (version: number) => (view: PlayerView) => view.version === version;

beforeEach(() => start());

afterEach(async () => {
  clients.splice(0).forEach((socket) => socket.disconnect());
  await server.close();
  vi.restoreAllMocks();
});

describe('Socket.IO-Durchstich', () => {
  it('erstellt einen Raum, füllt ihn, teilt aus und reizt bis zum Spielmacher', async () => {
    const anna = await client();
    const created = roomJoinedAckSchema.parse(
      await anna.emit('room:create', {
        displayName: 'Anna',
        config: { playerCount: 3, deckSize: 40 },
      }),
    );
    expect(created).toMatchObject({ ok: true, seat: 0 });
    if (!created.ok) return;
    expect(created.roomId).toMatch(/^[A-Z2-9]{6}$/);

    const lobby = await anna.waitFor<RoomView>('room:state');
    expect(roomViewSchema.parse(lobby)).toEqual({
      roomId: created.roomId,
      config,
      seats: [{ displayName: 'Anna', connected: true }, null, null],
    });

    const ben = await client();
    const cem = await client();
    await expect(
      ben.emit('room:join', { roomId: created.roomId.toLowerCase(), displayName: 'Ben' }),
    ).resolves.toMatchObject({ ok: true, seat: 1 });
    await expect(
      cem.emit('room:join', { roomId: created.roomId, displayName: 'Cem' }),
    ).resolves.toMatchObject({ ok: true, seat: 2 });

    const { hands, dabb } = deal(buildDeck(40), config, 0);
    const players = [anna, ben, cem];
    for (const [seat, player] of players.entries()) {
      const view = playerViewSchema.parse(await player.waitFor('game:state', stateWith(1)));
      expect(view).toMatchObject({
        phase: 'bidding',
        ownSeat: seat,
        dealer: 0,
        forehand: 1,
        activeSeat: 2,
      });
      expect(view.hand).toEqual(hands[seat]);

      // Datenleck (FA-05): weder Dabb noch fremde Hände in der serialisierten Sicht
      const json = JSON.stringify(view);
      const hidden = [...dabb, ...hands.filter((_, other) => other !== seat).flat()];
      for (const card of hidden) {
        expect(json).not.toContain(`"${card.id}"`);
      }
    }
    await expect(anna.waitFor<GameEventBatch>('game:events')).resolves.toEqual({
      version: 1,
      events: [{ type: 'roundStarted', dealer: 0, forehand: 1 }],
    });

    const bid = await cem.emit('game:intent', {
      expectedVersion: 1,
      intent: { type: 'bid', amount: 160 },
    });
    expect(intentAckSchema.parse(bid)).toEqual({ ok: true, version: 2 });
    await expect(
      anna.emit('game:intent', { expectedVersion: 2, intent: { type: 'pass' } }),
    ).resolves.toEqual({ ok: true, version: 3 });
    await expect(
      ben.emit('game:intent', { expectedVersion: 3, intent: { type: 'pass' } }),
    ).resolves.toEqual({ ok: true, version: 4 });

    for (const player of players) {
      await expect(player.waitFor('game:state', stateWith(4))).resolves.toMatchObject({
        phase: 'dabb',
        declarer: 2,
        bidding: { highestBid: 160, highestBidder: 2, passed: [0, 1] },
      });
      await expect(
        player.waitFor<GameEventBatch>('game:events', (batch) => batch.version === 4),
      ).resolves.toEqual({
        version: 4,
        events: [
          { type: 'passed', seat: 1 },
          { type: 'biddingWon', declarer: 2, bid: 160 },
        ],
      });
    }
  });

  it('beantwortet fehlerhafte Anfragen mit Fehlercodes', async () => {
    const anna = await client();

    await expect(
      anna.emit('game:intent', { expectedVersion: 0, intent: { type: 'pass' } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_IN_ROOM' } });
    await expect(anna.emit('room:leave', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_IN_ROOM' },
    });
    await expect(anna.emit('room:leave')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' },
    });
    await expect(
      anna.emit('room:create', { displayName: 'Anna', config: { playerCount: 5, deckSize: 40 } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD', message: expect.stringContaining('config.playerCount') },
    });
    await expect(
      anna.emit('room:create', {
        displayName: 'Anna',
        config: { playerCount: 3, deckSize: 40, mode: 'league' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONFIG', message: expect.stringContaining('MODE_NOT_SUPPORTED') },
    });
    await expect(
      anna.emit('room:join', { roomId: 'NICHTDA', displayName: 'Anna' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });
    await expect(anna.emit('session:resume', { sessionId: 'fremd' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'SESSION_NOT_FOUND' },
    });
  });

  it('lehnt veraltete Versionen, Züge außer der Reihe und volle Räume ab', async () => {
    const { roomId, players } = await fullRoom();
    const [anna, , cem] = players;

    await expect(
      cem.emit('game:intent', { expectedVersion: 0, intent: { type: 'pass' } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    await expect(
      anna.emit('game:intent', { expectedVersion: 1, intent: { type: 'pass' } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });

    const dora = await client();
    await expect(dora.emit('room:join', { roomId, displayName: 'Dora' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'ROOM_FULL' },
    });
  });

  it('führt parallele gleiche Intents nur einmal aus', async () => {
    const { players } = await fullRoom();
    const cem = players[2];
    const pass = { expectedVersion: 1, intent: { type: 'pass' } };

    const results = await Promise.all([
      cem.emit('game:intent', pass),
      cem.emit('game:intent', pass),
    ]);

    expect(results).toEqual([
      { ok: true, version: 2 },
      { ok: false, error: { code: 'STALE_STATE', message: expect.any(String) } },
    ]);
  });

  it('zeigt Trennungen an und nimmt die Sitzung über einen neuen Socket wieder auf', async () => {
    const { roomId, players, sessions } = await fullRoom();
    const [anna, ben] = players;

    ben.socket.disconnect();
    await anna.waitFor<PlayerView>('game:state', (view) => !view.seats[1].connected);

    const benAgain = await client();
    const resumed = sessionResumedAckSchema.parse(
      await benAgain.emit('session:resume', { sessionId: sessions[1] }),
    );
    expect(resumed).toEqual({ ok: true, roomId, seat: 1 });
    await expect(benAgain.waitFor('game:state')).resolves.toMatchObject({
      ownSeat: 1,
      version: 1,
    });
    await anna.waitFor<PlayerView>(
      'game:state',
      (view) => view.seats[1].connected && view.version === 1,
    );
  });

  it('trennt eine ältere Verbindung, wenn die Sitzung anderswo aufgenommen wird', async () => {
    const { players, sessions } = await fullRoom();
    const ben = players[1];
    const disconnected = new Promise<void>((resolve) =>
      ben.socket.once('disconnect', () => resolve()),
    );

    const benAgain = await client();
    await expect(
      benAgain.emit('session:resume', { sessionId: sessions[1] }),
    ).resolves.toMatchObject({ ok: true, seat: 1 });

    await disconnected;
    await expect(
      benAgain.emit('game:intent', { expectedVersion: 1, intent: { type: 'pass' } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
  });

  it('bricht das Spiel für alle ab, wenn jemand ein laufendes Spiel verlässt', async () => {
    const { players } = await fullRoom();
    const [anna, ben] = players;

    await expect(ben.emit('room:leave', {})).resolves.toEqual({ ok: true });

    await expect(
      anna.waitFor<GameEventBatch>('game:events', (batch) => batch.version === 2),
    ).resolves.toEqual({ version: 2, events: [{ type: 'gameAborted', reason: 'PLAYER_LEFT' }] });
    await expect(anna.waitFor('game:state', stateWith(2))).resolves.toMatchObject({
      phase: 'terminated',
      abortReason: 'PLAYER_LEFT',
    });
  });

  it('löst beim Wechsel in einen anderen Raum die alte Sitzung', async () => {
    const anna = await client();
    const first = roomJoinedAckSchema.parse(
      await anna.emit('room:create', { displayName: 'Anna', config }),
    );
    if (!first.ok) throw new Error(first.error.code);
    const ben = await client();
    await ben.emit('room:join', { roomId: first.roomId, displayName: 'Ben' });

    await anna.emit('room:create', { displayName: 'Anna', config });

    await expect(
      ben.waitFor<RoomView>('room:state', (view) => view.seats[0]?.connected === false),
    ).resolves.toMatchObject({ roomId: first.roomId });
  });

  it('meldet unerwartete Ausnahmen als INTERNAL_ERROR', async () => {
    await server.close();
    await start({
      ids: {
        roomId: () => {
          throw new Error('kaputt');
        },
        sessionId: () => 'session',
      },
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const anna = await client();

    await expect(anna.emit('room:create', { displayName: 'Anna', config })).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Interner Serverfehler.' },
    });
    expect(errors).toHaveBeenCalled();
  });
});
