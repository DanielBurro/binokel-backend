import { describe, expect, it } from 'vitest';
import { NO_SPECIAL_RULES, type GameConfig } from '../../domain/config/game-config';
import { createTestServices, type BroadcastMessage } from '../../test/fakes';
import type { RoomJoinedResult } from '../ports/inbound/create-room.port';
import { MAX_ROOM_ID_ATTEMPTS, normalizeRoomId } from './room-service';

const config: GameConfig = {
  playerCount: 3,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

function joined(result: RoomJoinedResult) {
  if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
  return result;
}

type Services = ReturnType<typeof createTestServices>;

/** Legt einen Raum an; jeder Name sitzt auf seinem Index, Verbindung `conn-<index>`. */
async function lobby({ rooms }: Services, playerNames: readonly string[]) {
  const [first, ...rest] = playerNames;
  const host = joined(
    await rooms.createRoom({ displayName: first, config, connectionId: 'conn-0' }),
  );
  const guests = [];
  for (const [index, displayName] of rest.entries()) {
    guests.push(
      joined(
        await rooms.joinRoom({
          roomId: host.roomId,
          displayName,
          connectionId: `conn-${index + 1}`,
        }),
      ),
    );
  }
  return [host, ...guests];
}

const ofKind = <K extends BroadcastMessage['kind']>(messages: BroadcastMessage[], kind: K) =>
  messages.filter(
    (message): message is Extract<BroadcastMessage, { kind: K }> => message.kind === kind,
  );

describe('RoomService', () => {
  describe('createRoom', () => {
    it('legt den Raum an, setzt den Ersteller auf Sitz 0 und meldet die Lobby', async () => {
      const services = createTestServices();
      const result = await services.rooms.createRoom({
        displayName: 'Anna',
        config,
        connectionId: 'conn-0',
      });

      expect(result).toEqual({ ok: true, roomId: 'ROOM01', seat: 0, sessionId: 'session-1' });
      expect(services.repository.rooms.get('ROOM01')).toEqual({
        id: 'ROOM01',
        config,
        seats: [
          { sessionId: 'session-1', displayName: 'Anna', connectionId: 'conn-0' },
          null,
          null,
        ],
        game: null,
        lastActivityAt: 1_000,
      });
      expect(services.messages).toEqual([
        { kind: 'subscribe', connectionId: 'conn-0', roomId: 'ROOM01' },
        {
          kind: 'roomState',
          roomId: 'ROOM01',
          view: {
            roomId: 'ROOM01',
            config,
            seats: [{ displayName: 'Anna', connected: true }, null, null],
          },
        },
      ]);
    });

    it('lehnt nicht unterstützte Konfigurationen mit Begründung ab', async () => {
      const services = createTestServices();
      const result = await services.rooms.createRoom({
        displayName: 'Anna',
        config: { ...config, specialRules: { ...NO_SPECIAL_RULES, rufen: true } },
        connectionId: 'conn-0',
      });

      expect(result).toEqual({
        ok: false,
        code: 'INVALID_CONFIG',
        details: ['SPECIAL_RULE_NOT_SUPPORTED'],
      });
      expect(services.repository.rooms.size).toBe(0);
    });

    it('zieht bei einer Kollision eine neue Raum-ID', async () => {
      const services = createTestServices(['AAAAAA', 'AAAAAA', 'BBBBBB']);
      await lobby(services, ['Anna']);

      const second = joined(
        await services.rooms.createRoom({ displayName: 'Ben', config, connectionId: 'conn-9' }),
      );

      expect(second.roomId).toBe('BBBBBB');
    });

    it('gibt nach zu vielen Kollisionen auf', async () => {
      const services = createTestServices(Array(MAX_ROOM_ID_ATTEMPTS + 1).fill('AAAAAA'));
      await lobby(services, ['Anna']);

      await expect(
        services.rooms.createRoom({ displayName: 'Ben', config, connectionId: 'conn-9' }),
      ).rejects.toThrow('Keine freie Raum-ID');
    });
  });

  describe('joinRoom', () => {
    it('vergibt Sitze in Beitrittsreihenfolge und ignoriert Groß- und Kleinschreibung', async () => {
      const services = createTestServices();
      const [host] = await lobby(services, ['Anna']);

      const result = await services.rooms.joinRoom({
        roomId: ` ${host.roomId.toLowerCase()} `,
        displayName: 'Ben',
        connectionId: 'conn-1',
      });

      expect(result).toEqual({ ok: true, roomId: host.roomId, seat: 1, sessionId: 'session-2' });
      expect(ofKind(services.messages, 'roomState').at(-1)?.view.seats).toEqual([
        { displayName: 'Anna', connected: true },
        { displayName: 'Ben', connected: true },
        null,
      ]);
    });

    it('meldet unbekannte Räume', async () => {
      const services = createTestServices();

      await expect(
        services.rooms.joinRoom({ roomId: 'NICHTDA', displayName: 'Ben', connectionId: 'conn-1' }),
      ).resolves.toEqual({ ok: false, code: 'ROOM_NOT_FOUND' });
    });

    it('startet das Spiel, sobald der Raum voll ist, und sendet jedem seine Sicht', async () => {
      const services = createTestServices();
      const [host] = await lobby(services, ['Anna', 'Ben', 'Cem']);

      const room = services.repository.rooms.get(host.roomId)!;
      expect(room.game).toMatchObject({ phase: 'bidding', version: 1, dealer: 0 });

      const views = ofKind(services.messages, 'playerView');
      expect(views.map(({ connectionId, view }) => [connectionId, view.ownSeat])).toEqual([
        ['conn-0', 0],
        ['conn-1', 1],
        ['conn-2', 2],
      ]);
      expect(views[0].view.hand).toEqual(room.game!.round!.hands[0]);
      expect(ofKind(services.messages, 'gameEvents')).toEqual([
        {
          kind: 'gameEvents',
          roomId: host.roomId,
          batch: { version: 1, events: [{ type: 'roundStarted', dealer: 0, forehand: 1 }] },
        },
      ]);
    });

    it('lehnt Beitritte in einen vollen Raum ab', async () => {
      const services = createTestServices();
      const [host] = await lobby(services, ['Anna', 'Ben', 'Cem']);

      await expect(
        services.rooms.joinRoom({ roomId: host.roomId, displayName: 'Dora', connectionId: 'c-3' }),
      ).resolves.toEqual({ ok: false, code: 'ROOM_FULL' });
    });
  });

  describe('leaveRoom', () => {
    it('gibt in der Lobby den Sitz frei, der nächste Beitritt bekommt ihn', async () => {
      const services = createTestServices();
      const [host, ben] = await lobby(services, ['Anna', 'Ben']);

      await expect(services.rooms.leaveRoom({ sessionId: ben.sessionId })).resolves.toEqual({
        ok: true,
      });
      expect(services.messages).toContainEqual({
        kind: 'unsubscribe',
        connectionId: 'conn-1',
        roomId: host.roomId,
      });
      expect(ofKind(services.messages, 'roomState').at(-1)?.view.seats).toEqual([
        { displayName: 'Anna', connected: true },
        null,
        null,
      ]);

      const cem = joined(
        await services.rooms.joinRoom({
          roomId: host.roomId,
          displayName: 'Cem',
          connectionId: 'conn-2',
        }),
      );
      expect(cem.seat).toBe(1);
    });

    it('löscht den Raum, wenn der letzte Spieler die Lobby verlässt', async () => {
      const services = createTestServices();
      const [host] = await lobby(services, ['Anna']);

      await services.rooms.leaveRoom({ sessionId: host.sessionId });

      expect(services.repository.rooms.has(host.roomId)).toBe(false);
    });

    it('bricht ein laufendes Spiel für alle ab', async () => {
      const services = createTestServices();
      const [host, ben] = await lobby(services, ['Anna', 'Ben', 'Cem']);
      services.messages.length = 0;

      await services.rooms.leaveRoom({ sessionId: ben.sessionId });

      const room = services.repository.rooms.get(host.roomId)!;
      expect(room.game).toMatchObject({ phase: 'terminated', abortReason: 'PLAYER_LEFT' });
      expect(room.seats[1]).toMatchObject({ displayName: 'Ben', connectionId: null });
      expect(ofKind(services.messages, 'playerView').map((m) => m.connectionId)).toEqual([
        'conn-0',
        'conn-2',
      ]);
      expect(ofKind(services.messages, 'gameEvents').at(-1)?.batch.events).toEqual([
        { type: 'gameAborted', reason: 'PLAYER_LEFT' },
      ]);
    });

    it('verlässt ein beendetes Spiel ohne weiteren Abbruch', async () => {
      const services = createTestServices();
      const [host, ben, cem] = await lobby(services, ['Anna', 'Ben', 'Cem']);
      await services.rooms.leaveRoom({ sessionId: ben.sessionId });
      services.messages.length = 0;

      await services.rooms.leaveRoom({ sessionId: cem.sessionId });

      expect(services.repository.rooms.get(host.roomId)!.game?.version).toBe(2);
      expect(ofKind(services.messages, 'gameEvents')).toEqual([]);
      expect(ofKind(services.messages, 'playerView').map((m) => m.view.seats[2].connected)).toEqual(
        [false],
      );
    });

    it('meldet unbekannte Sessions', async () => {
      const services = createTestServices();

      await expect(services.rooms.leaveRoom({ sessionId: 'fremd' })).resolves.toEqual({
        ok: false,
        code: 'SESSION_NOT_FOUND',
      });
    });
  });

  describe('Verbindungen', () => {
    it('markiert getrennte Sitze und ignoriert verspätete Trennungen alter Verbindungen', async () => {
      const services = createTestServices();
      const [host, ben] = await lobby(services, ['Anna', 'Ben', 'Cem']);

      await services.rooms.disconnect({ sessionId: ben.sessionId, connectionId: 'conn-alt' });
      expect(services.repository.rooms.get(host.roomId)!.seats[1]?.connectionId).toBe('conn-1');

      await services.rooms.disconnect({ sessionId: ben.sessionId, connectionId: 'conn-1' });
      expect(services.repository.rooms.get(host.roomId)!.seats[1]?.connectionId).toBeNull();
      expect(ofKind(services.messages, 'playerView').at(-1)?.view.seats[1].connected).toBe(false);
    });

    it('nimmt eine Sitzung über eine neue Verbindung wieder auf', async () => {
      const services = createTestServices();
      const [host, ben] = await lobby(services, ['Anna', 'Ben', 'Cem']);
      await services.rooms.disconnect({ sessionId: ben.sessionId, connectionId: 'conn-1' });
      services.messages.length = 0;

      const result = await services.rooms.resumeSession({
        sessionId: ben.sessionId,
        connectionId: 'conn-neu',
      });

      expect(result).toEqual({
        ok: true,
        roomId: host.roomId,
        seat: 1,
        replacedConnectionId: null,
      });
      expect(services.messages[0]).toEqual({
        kind: 'subscribe',
        connectionId: 'conn-neu',
        roomId: host.roomId,
      });
      const resumed = ofKind(services.messages, 'playerView').find(
        (message) => message.connectionId === 'conn-neu',
      );
      expect(resumed?.view).toMatchObject({ ownSeat: 1, version: 1 });
      expect(resumed?.view.seats[1].connected).toBe(true);
      expect(ofKind(services.messages, 'gameEvents')).toEqual([]);
    });

    it('löst beim Wiederaufnehmen eine noch offene Verbindung ab', async () => {
      const services = createTestServices();
      const [host, ben] = await lobby(services, ['Anna', 'Ben']);

      const result = await services.rooms.resumeSession({
        sessionId: ben.sessionId,
        connectionId: 'conn-neu',
      });

      expect(result).toMatchObject({ ok: true, replacedConnectionId: 'conn-1' });
      expect(services.messages).toContainEqual({
        kind: 'unsubscribe',
        connectionId: 'conn-1',
        roomId: host.roomId,
      });
    });

    it('behandelt ein wiederholtes Resume derselben Verbindung als Auffrischung', async () => {
      const services = createTestServices();
      const [, ben] = await lobby(services, ['Anna', 'Ben']);
      services.messages.length = 0;

      const result = await services.rooms.resumeSession({
        sessionId: ben.sessionId,
        connectionId: 'conn-1',
      });

      expect(result).toMatchObject({ ok: true, replacedConnectionId: null });
      expect(ofKind(services.messages, 'unsubscribe')).toEqual([]);
    });

    it('lässt auch getrennte Spieler die Lobby verlassen', async () => {
      const services = createTestServices();
      const [host, ben] = await lobby(services, ['Anna', 'Ben']);
      await services.rooms.disconnect({ sessionId: ben.sessionId, connectionId: 'conn-1' });
      services.messages.length = 0;

      await services.rooms.leaveRoom({ sessionId: ben.sessionId });

      expect(ofKind(services.messages, 'unsubscribe')).toEqual([]);
      expect(services.repository.rooms.get(host.roomId)!.seats[1]).toBeNull();
    });

    it('meldet unbekannte Sessions beim Wiederaufnehmen', async () => {
      const services = createTestServices();

      await expect(
        services.rooms.resumeSession({ sessionId: 'fremd', connectionId: 'conn-0' }),
      ).resolves.toEqual({ ok: false, code: 'SESSION_NOT_FOUND' });
      await expect(
        services.rooms.disconnect({ sessionId: 'fremd', connectionId: 'conn-0' }),
      ).resolves.toBeUndefined();
    });
  });

  it('normalisiert Raum-IDs', () => {
    expect(normalizeRoomId('  k7qx2a ')).toBe('K7QX2A');
  });
});
