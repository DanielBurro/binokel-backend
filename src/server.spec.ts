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

  it('lässt den Spielmacher den Dabb aufnehmen und drücken, ohne ihn anderen zu zeigen', async () => {
    const { players } = await fullRoom();
    const [anna, ben, cem] = players;
    await cem.emit('game:intent', { expectedVersion: 1, intent: { type: 'bid', amount: 160 } });
    await anna.emit('game:intent', { expectedVersion: 2, intent: { type: 'pass' } });
    await ben.emit('game:intent', { expectedVersion: 3, intent: { type: 'pass' } });

    const { hands, dabb } = deal(buildDeck(40), config, 0);
    const dabbIds = dabb.map((card) => `"${card.id}"`);
    await expect(cem.waitFor('game:state', stateWith(4))).resolves.toMatchObject({
      activeSeat: 2,
      availableActions: [{ type: 'takeDabb' }],
    });
    await expect(
      anna.emit('game:intent', { expectedVersion: 4, intent: { type: 'takeDabb' } }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });

    await expect(
      cem.emit('game:intent', { expectedVersion: 4, intent: { type: 'takeDabb' } }),
    ).resolves.toEqual({ ok: true, version: 5 });
    const taken = playerViewSchema.parse(await cem.waitFor('game:state', stateWith(5)));
    expect(taken.dabb).toEqual({ size: 4, status: 'taken', cards: dabb });
    expect(taken.hand).toEqual([...hands[2], ...dabb]);
    expect(taken.availableActions).toEqual([{ type: 'discardToDabb', count: 4 }]);
    for (const other of [anna, ben]) {
      const view = playerViewSchema.parse(await other.waitFor('game:state', stateWith(5)));
      expect(view.dabb).toEqual({ size: 4, status: 'taken', cards: null });
      const json = JSON.stringify(view);
      for (const id of dabbIds) expect(json).not.toContain(id);
    }

    const pressed = taken.hand.slice(0, 4);
    await expect(
      cem.emit('game:intent', {
        expectedVersion: 5,
        intent: { type: 'discardToDabb', cardIds: pressed.slice(0, 3).map((card) => card.id) },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'WRONG_DISCARD_COUNT' } });
    await expect(
      cem.emit('game:intent', {
        expectedVersion: 5,
        intent: { type: 'discardToDabb', cardIds: pressed.map((card) => card.id) },
      }),
    ).resolves.toEqual({ ok: true, version: 6 });

    await expect(cem.waitFor('game:state', stateWith(6))).resolves.toMatchObject({
      phase: 'declare',
      dabb: { size: 4, status: 'discarded', cards: pressed },
      availableActions: [{ type: 'declare', modes: ['play', 'abgehen'] }],
    });
    for (const other of [anna, ben]) {
      await expect(other.waitFor('game:state', stateWith(6))).resolves.toMatchObject({
        phase: 'declare',
        dabb: { size: 4, status: 'discarded', cards: null },
      });
      await expect(
        other.waitFor<GameEventBatch>('game:events', (batch) => batch.version === 6),
      ).resolves.toEqual({ version: 6, events: [{ type: 'dabbDiscarded', seat: 2 }] });
    }
  });

  it('lässt den Spielmacher Trumpf und Spielart ansagen und zeigt sie allen', async () => {
    const { players } = await fullRoom();
    const [anna, ben, cem] = players;
    await cem.emit('game:intent', { expectedVersion: 1, intent: { type: 'bid', amount: 160 } });
    await anna.emit('game:intent', { expectedVersion: 2, intent: { type: 'pass' } });
    await ben.emit('game:intent', { expectedVersion: 3, intent: { type: 'pass' } });
    await cem.emit('game:intent', { expectedVersion: 4, intent: { type: 'takeDabb' } });
    const taken = playerViewSchema.parse(await cem.waitFor('game:state', stateWith(5)));
    await cem.emit('game:intent', {
      expectedVersion: 5,
      intent: { type: 'discardToDabb', cardIds: taken.hand.slice(0, 4).map((card) => card.id) },
    });
    await expect(cem.waitFor('game:state', stateWith(6))).resolves.toMatchObject({
      phase: 'declare',
      activeSeat: 2,
      declaration: null,
      availableActions: [{ type: 'declare', modes: ['play', 'abgehen'] }],
    });

    await expect(
      cem.emit('game:intent', {
        expectedVersion: 6,
        intent: { type: 'declare', trump: 'pik', mode: 'play' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    await expect(
      anna.emit('game:intent', {
        expectedVersion: 6,
        intent: { type: 'declare', trump: 'herz', mode: 'play' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    await expect(
      cem.emit('game:intent', {
        expectedVersion: 6,
        intent: { type: 'declare', trump: 'herz', mode: 'abgehen' },
      }),
    ).resolves.toEqual({ ok: true, version: 7 });

    for (const player of [anna, ben, cem]) {
      const view = playerViewSchema.parse(await player.waitFor('game:state', stateWith(7)));
      expect(view).toMatchObject({
        phase: 'meld',
        declaration: { trump: 'herz', mode: 'abgehen' },
      });
      await expect(
        player.waitFor<GameEventBatch>('game:events', (batch) => batch.version === 7),
      ).resolves.toEqual({
        version: 7,
        events: [{ type: 'declared', seat: 2, trump: 'herz', mode: 'abgehen' }],
      });
    }
  });

  it('lässt ab dem Spielmacher reihum melden und zeigt die Meldungen allen', async () => {
    const { players } = await fullRoom();
    const [anna, ben, cem] = players;
    await cem.emit('game:intent', { expectedVersion: 1, intent: { type: 'bid', amount: 160 } });
    await anna.emit('game:intent', { expectedVersion: 2, intent: { type: 'pass' } });
    await ben.emit('game:intent', { expectedVersion: 3, intent: { type: 'pass' } });
    await cem.emit('game:intent', { expectedVersion: 4, intent: { type: 'takeDabb' } });
    const taken = playerViewSchema.parse(await cem.waitFor('game:state', stateWith(5)));
    await cem.emit('game:intent', {
      expectedVersion: 5,
      intent: { type: 'discardToDabb', cardIds: taken.hand.slice(0, 4).map((card) => card.id) },
    });
    await cem.emit('game:intent', {
      expectedVersion: 6,
      intent: { type: 'declare', trump: 'herz', mode: 'play' },
    });

    // Cem meldet als Spielmacher zuerst; das ungemischte Blatt gibt ihm nichts zu melden.
    await expect(cem.waitFor('game:state', stateWith(7))).resolves.toMatchObject({
      phase: 'meld',
      activeSeat: 2,
      availableActions: [{ type: 'submitMelds', melds: [] }],
    });
    const meld = (player: TestClient, expectedVersion: number, meldIds: string[]) =>
      player.emit('game:intent', { expectedVersion, intent: { type: 'submitMelds', meldIds } });
    await expect(meld(anna, 7, [])).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_YOUR_TURN' },
    });
    await expect(meld(cem, 7, [])).resolves.toEqual({ ok: true, version: 8 });
    await expect(meld(anna, 8, ['paar-herz-1'])).resolves.toMatchObject({
      ok: false,
      error: { code: 'MELD_NOT_OFFERED' },
    });
    await expect(meld(anna, 8, [])).resolves.toEqual({ ok: true, version: 9 });

    // Ben bekommt zwei Paare vorgeschlagen und meldet nur eines.
    const offer = playerViewSchema.parse(await ben.waitFor('game:state', stateWith(9)));
    expect(offer.availableActions).toEqual([
      {
        type: 'submitMelds',
        melds: [
          expect.objectContaining({ id: 'paar-gruen-1', points: 20 }),
          expect.objectContaining({ id: 'paar-gruen-2', points: 20 }),
        ],
      },
    ]);
    await expect(meld(ben, 9, ['paar-gruen-1', 'paar-gruen-1'])).resolves.toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_MELDS' },
    });
    await expect(meld(ben, 9, ['paar-gruen-1'])).resolves.toEqual({ ok: true, version: 10 });

    const [proposal] = offer.availableActions;
    if (proposal.type !== 'submitMelds') throw new Error(`Unerwartetes Angebot ${proposal.type}`);
    const paar = proposal.melds[0];
    for (const player of [anna, ben, cem]) {
      const view = playerViewSchema.parse(await player.waitFor('game:state', stateWith(10)));
      expect(view).toMatchObject({
        phase: 'trick',
        melds: [
          { melds: [], points: 0 },
          { melds: [paar], points: 20 },
          { melds: [], points: 0 },
        ],
      });
      await expect(
        player.waitFor<GameEventBatch>('game:events', (batch) => batch.version === 10),
      ).resolves.toEqual({
        version: 10,
        events: [{ type: 'meldsSubmitted', seat: 1, melds: [paar], points: 20 }],
      });
    }
  });

  it('spielt einen Stich mit Farb- und Trumpfzwang und zeigt ihn allen', async () => {
    const { players } = await fullRoom();
    const [anna, ben, cem] = players;
    await cem.emit('game:intent', { expectedVersion: 1, intent: { type: 'bid', amount: 160 } });
    await anna.emit('game:intent', { expectedVersion: 2, intent: { type: 'pass' } });
    await ben.emit('game:intent', { expectedVersion: 3, intent: { type: 'pass' } });
    await cem.emit('game:intent', { expectedVersion: 4, intent: { type: 'takeDabb' } });
    const taken = playerViewSchema.parse(await cem.waitFor('game:state', stateWith(5)));
    await cem.emit('game:intent', {
      expectedVersion: 5,
      intent: { type: 'discardToDabb', cardIds: taken.hand.slice(0, 4).map((card) => card.id) },
    });
    await cem.emit('game:intent', {
      expectedVersion: 6,
      intent: { type: 'declare', trump: 'herz', mode: 'play' },
    });
    const meld = { type: 'submitMelds', meldIds: [] };
    await cem.emit('game:intent', { expectedVersion: 7, intent: meld });
    await anna.emit('game:intent', { expectedVersion: 8, intent: meld });
    await ben.emit('game:intent', { expectedVersion: 9, intent: meld });
    const playCard = (player: TestClient, expectedVersion: number, cardId: string) =>
      player.emit('game:intent', { expectedVersion, intent: { type: 'playCard', cardId } });

    // Ben spielt als Vorhand aus, mit dem ungemischten Blatt darf er alles legen.
    const opening = playerViewSchema.parse(await ben.waitFor('game:state', stateWith(10)));
    expect(opening).toMatchObject({ phase: 'trick', activeSeat: 1, trick: { plays: [] } });
    expect(opening.availableActions).toEqual([
      { type: 'playCard', cardIds: opening.hand.map((card) => card.id) },
    ]);
    await expect(playCard(ben, 10, 'eichel-ass-1')).resolves.toEqual({ ok: true, version: 11 });

    // Cem hat kein Eichel und muss trumpfen.
    await expect(cem.waitFor('game:state', stateWith(11))).resolves.toMatchObject({
      activeSeat: 2,
      trick: { plays: [{ seat: 1, card: { id: 'eichel-ass-1' } }] },
      availableActions: [
        { type: 'playCard', cardIds: ['herz-ass-1', 'herz-ass-2', 'herz-ober-1', 'herz-ober-2'] },
      ],
    });
    await expect(playCard(cem, 11, 'gruen-unter-1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'CARD_NOT_ALLOWED' },
    });
    await expect(playCard(cem, 11, 'herz-ober-1')).resolves.toEqual({ ok: true, version: 12 });

    // Anna muss Eichel bedienen, auch wenn sie den Trumpf nicht schlagen kann.
    await expect(playCard(anna, 12, 'herz-zehn-1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'CARD_NOT_ALLOWED' },
    });
    await expect(playCard(anna, 12, 'eichel-unter-1')).resolves.toEqual({ ok: true, version: 13 });

    for (const player of [anna, ben, cem]) {
      const view = playerViewSchema.parse(await player.waitFor('game:state', stateWith(13)));
      expect(view).toMatchObject({
        phase: 'trick',
        activeSeat: 2,
        trick: { plays: [] },
        lastTrick: {
          plays: [
            { seat: 1, card: { id: 'eichel-ass-1' } },
            { seat: 2, card: { id: 'herz-ober-1' } },
            { seat: 0, card: { id: 'eichel-unter-1' } },
          ],
          winner: 2,
        },
      });
      expect(view.seats.map((seat) => seat.handSize)).toEqual([11, 11, 11]);
      await expect(
        player.waitFor<GameEventBatch>('game:events', (batch) => batch.version === 13),
      ).resolves.toMatchObject({
        version: 13,
        events: [
          { type: 'cardPlayed', seat: 0, card: { id: 'eichel-unter-1' } },
          { type: 'trickWon', winner: 2 },
        ],
      });
    }
  });

  describe('Abrechnung', () => {
    /** Reizen bis zur Ansage: Cem wird mit 160 Spielmacher, drückt und sagt Herz an. */
    async function declared(mode: 'play' | 'abgehen') {
      const { players } = await fullRoom();
      const [anna, ben, cem] = players;
      await cem.emit('game:intent', { expectedVersion: 1, intent: { type: 'bid', amount: 160 } });
      await anna.emit('game:intent', { expectedVersion: 2, intent: { type: 'pass' } });
      await ben.emit('game:intent', { expectedVersion: 3, intent: { type: 'pass' } });
      await cem.emit('game:intent', { expectedVersion: 4, intent: { type: 'takeDabb' } });
      const taken = playerViewSchema.parse(await cem.waitFor('game:state', stateWith(5)));
      await cem.emit('game:intent', {
        expectedVersion: 5,
        intent: { type: 'discardToDabb', cardIds: taken.hand.slice(0, 4).map((card) => card.id) },
      });
      await cem.emit('game:intent', {
        expectedVersion: 6,
        intent: { type: 'declare', trump: 'herz', mode },
      });
      return players;
    }
    const meld = (player: TestClient, expectedVersion: number, meldIds: string[]) =>
      player.emit('game:intent', { expectedVersion, intent: { type: 'submitMelds', meldIds } });

    it('wertet das Abgehen nach den Meldungen der Gegner', async () => {
      const [anna, ben, cem] = await declared('abgehen');
      // Cem meldet nicht; Anna hat nichts, Ben meldet seine zwei Grün-Paare.
      await expect(meld(anna, 7, [])).resolves.toEqual({ ok: true, version: 8 });
      await expect(meld(ben, 8, ['paar-gruen-1', 'paar-gruen-2'])).resolves.toEqual({
        ok: true,
        version: 9,
      });

      for (const player of [anna, ben, cem]) {
        const view = playerViewSchema.parse(await player.waitFor('game:state', stateWith(9)));
        expect(view).toMatchObject({
          phase: 'score',
          activeSeat: null,
          availableActions: [],
          // Gegner: Meldepunkte plus 3 · 10, Spielmacher: −Reizwert.
          roundResult: {
            outcome: 'abgehen',
            parties: [
              { trickPoints: 0, meldPoints: 0, meldsCounted: true, delta: 30 },
              { trickPoints: 0, meldPoints: 40, meldsCounted: true, delta: 70 },
              { trickPoints: 0, meldPoints: 0, meldsCounted: false, delta: -160 },
            ],
          },
          scores: [30, 70, -160],
        });
        await expect(
          player.waitFor<GameEventBatch>('game:events', (batch) => batch.version === 9),
        ).resolves.toMatchObject({
          events: [
            { type: 'meldsSubmitted', seat: 1 },
            { type: 'roundScored', outcome: 'abgehen' },
          ],
        });
      }
    });

    it('wertet ein ausgespieltes Spiel nach dem letzten Stich', async () => {
      const players = await declared('play');
      const [anna, ben, cem] = players;
      await meld(cem, 7, []);
      await meld(anna, 8, []);
      await meld(ben, 9, []);

      // Alle 36 Karten: Wer am Zug ist, legt seine erste erlaubte Karte.
      for (let version = 10; version < 46; version++) {
        const { activeSeat } = playerViewSchema.parse(
          await anna.waitFor('game:state', stateWith(version)),
        );
        const active = players[activeSeat!];
        const view = playerViewSchema.parse(await active.waitFor('game:state', stateWith(version)));
        const [offer] = view.availableActions;
        if (offer.type !== 'playCard') throw new Error(`Unerwartetes Angebot ${offer.type}`);
        await expect(
          active.emit('game:intent', {
            expectedVersion: version,
            intent: { type: 'playCard', cardId: offer.cardIds[0] },
          }),
        ).resolves.toEqual({ ok: true, version: version + 1 });
      }

      for (const player of [anna, ben, cem]) {
        const view = playerViewSchema.parse(await player.waitFor('game:state', stateWith(46)));
        expect(view).toMatchObject({ phase: 'score', hand: [], trick: null });
        expect(view.roundResult?.outcome).toMatch(/^(made|failed)$/);
        expect(view.scores).toEqual(view.roundResult!.parties.map((party) => party.delta));
        await expect(
          player.waitFor<GameEventBatch>('game:events', (batch) => batch.version === 46),
        ).resolves.toMatchObject({
          events: [
            { type: 'cardPlayed' },
            { type: 'trickWon' },
            { type: 'roundScored', outcome: view.roundResult!.outcome },
          ],
        });
      }
    });
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

  it('beantwortet GET /health ohne Cache mit Status und Laufzeit', async () => {
    await server.close();
    let now = 1_000_000;
    await start({ clock: { now: () => now } });
    now += 61_999;

    const response = await fetch(`${url}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-powered-by')).toBeNull();
    await expect(response.json()).resolves.toEqual({ status: 'ok', uptimeSeconds: 61 });
  });

  it('antwortet auf unbekannte HTTP-Pfade mit 404', async () => {
    const response = await fetch(`${url}/unbekannt`);

    expect(response.status).toBe(404);
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
