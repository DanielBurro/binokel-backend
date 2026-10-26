import { describe, expect, it } from 'vitest';
import { NO_SPECIAL_RULES, type GameConfig } from '../../domain/config/game-config';
import {
  createFakeClock,
  createFakeRoomRepository,
  createRecordingBroadcaster,
  createTestServices,
} from '../../test/fakes';
import type { Room } from '../model/room';
import { createGameService } from './game-service';
import { createRoomStore } from './room-store';

const config: GameConfig = {
  playerCount: 3,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

/** Voller Raum mit Geber 0, Vorhand 1; Sitz 2 ist zuerst am Zug. */
async function started() {
  const services = createTestServices();
  const sessions: string[] = [];
  for (const [seat, displayName] of ['Anna', 'Ben', 'Cem'].entries()) {
    const connectionId = `conn-${seat}`;
    const result =
      seat === 0
        ? await services.rooms.createRoom({ displayName, config, connectionId })
        : await services.rooms.joinRoom({ roomId: 'ROOM01', displayName, connectionId });
    if (!result.ok) throw new Error(result.code);
    sessions.push(result.sessionId);
  }
  services.messages.length = 0;
  const room = () => services.repository.rooms.get('ROOM01')!;
  return { ...services, sessions, room };
}

describe('GameService', () => {
  it('führt einen Zug aus und sendet Zustände und Ereignisse', async () => {
    const { games, sessions, messages, room } = await started();

    const result = await games.executeMove({
      sessionId: sessions[2],
      expectedVersion: 1,
      intent: { type: 'bid', amount: 160 },
    });

    expect(result).toEqual({ ok: true, version: 2 });
    expect(room().game).toMatchObject({ version: 2, round: { bidding: { highestBid: 160 } } });
    expect(messages.map((message) => message.kind)).toEqual([
      'playerView',
      'playerView',
      'playerView',
      'gameEvents',
    ]);
    expect(messages.at(-1)).toEqual({
      kind: 'gameEvents',
      roomId: 'ROOM01',
      batch: { version: 2, events: [{ type: 'bidPlaced', seat: 2, amount: 160 }] },
    });
  });

  it('erkennt den Spielmacher nach dem Reizen', async () => {
    const { games, sessions, room } = await started();

    await games.executeMove({
      sessionId: sessions[2],
      expectedVersion: 1,
      intent: { type: 'pass' },
    });
    await games.executeMove({
      sessionId: sessions[0],
      expectedVersion: 2,
      intent: { type: 'pass' },
    });

    expect(room().game).toMatchObject({ phase: 'dabb', round: { declarer: 1 } });
  });

  it('lehnt veraltete Versionen mit STALE_STATE ab', async () => {
    const { games, sessions, messages, room } = await started();

    const result = await games.executeMove({
      sessionId: sessions[2],
      expectedVersion: 0,
      intent: { type: 'pass' },
    });

    expect(result).toEqual({ ok: false, code: 'STALE_STATE' });
    expect(room().game?.version).toBe(1);
    expect(messages).toEqual([]);
  });

  it('reicht Regelverstöße der Engine weiter und lässt den Zustand unverändert', async () => {
    const { games, sessions, room } = await started();
    const before = room();

    const result = await games.executeMove({
      sessionId: sessions[0],
      expectedVersion: 1,
      intent: { type: 'pass' },
    });

    expect(result).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(room()).toBe(before);
  });

  it('nimmt in der Lobby keine Züge an', async () => {
    const services = createTestServices();
    const host = await services.rooms.createRoom({
      displayName: 'Anna',
      config,
      connectionId: 'c',
    });
    if (!host.ok) throw new Error(host.code);

    await expect(
      services.games.executeMove({
        sessionId: host.sessionId,
        expectedVersion: 0,
        intent: { type: 'pass' },
      }),
    ).resolves.toEqual({ ok: false, code: 'WRONG_PHASE' });
  });

  it('meldet unbekannte Sessions', async () => {
    const { games } = await started();

    await expect(
      games.executeMove({ sessionId: 'fremd', expectedVersion: 1, intent: { type: 'pass' } }),
    ).resolves.toEqual({ ok: false, code: 'SESSION_NOT_FOUND' });
  });

  it('führt parallele Intents eines Raums strikt nacheinander aus (NFA-04)', async () => {
    const { games, sessions, room } = await started();
    const move = { sessionId: sessions[2], expectedVersion: 1, intent: { type: 'pass' } } as const;

    const results = await Promise.all([games.executeMove(move), games.executeMove(move)]);

    expect(results).toEqual([
      { ok: true, version: 2 },
      { ok: false, code: 'STALE_STATE' },
    ]);
    expect(room().game).toMatchObject({ version: 2, round: { bidding: { passed: [2] } } });
  });

  describe('System-Intents', () => {
    it('startet kein zweites Spiel im selben Raum', async () => {
      const { games, room } = await started();

      expect(() => games.startGame(room())).toThrow('läuft bereits');
    });

    it('bricht nur laufende Spiele ab', async () => {
      const { games, room, messages } = await started();
      const lobby: Room = { ...room(), game: null };

      await expect(games.abortGame(lobby, 'PLAYER_LEFT')).resolves.toBe(lobby);

      const aborted = await games.abortGame(room(), 'PLAYER_LEFT');
      expect(aborted.game).toMatchObject({ phase: 'terminated', version: 2 });
      await expect(games.abortGame(aborted, 'PLAYER_LEFT')).resolves.toBe(aborted);
      expect(messages.filter((message) => message.kind === 'gameEvents')).toHaveLength(1);
    });

    it('meldet abgelehnte System-Intents als Programmierfehler', async () => {
      const { room } = await started();
      const { broadcaster } = createRecordingBroadcaster();
      const games = createGameService({
        store: createRoomStore(createFakeRoomRepository(), createFakeClock()),
        broadcaster,
        shuffler: { shuffle: (items) => items.slice(1) },
      });

      await expect(games.startGame({ ...room(), game: null })).rejects.toThrow('INVALID_DECK');
    });
  });
});
