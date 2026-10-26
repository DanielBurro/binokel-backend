import { describe, expect, it } from 'vitest';
import { NO_SPECIAL_RULES, type GameConfig } from '../../domain/config/game-config';
import { createGame } from '../../domain/state/game-state';
import { createRecordingBroadcaster } from '../../test/fakes';
import type { Room } from '../model/room';
import { publishRoom } from './publish-room';

const config: GameConfig = {
  playerCount: 3,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

const room: Room = {
  id: 'ROOM01',
  config,
  seats: [
    { sessionId: 's-0', displayName: 'Anna', connectionId: 'conn-0' },
    { sessionId: 's-1', displayName: 'Ben', connectionId: null },
    { sessionId: 's-2', displayName: 'Cem', connectionId: 'conn-2' },
  ],
  game: createGame(config, 0),
  lastActivityAt: 0,
};

describe('publishRoom', () => {
  it('sendet nur verbundenen Sitzen ihre Sicht und ohne Ereignisse keine Ereignisliste', () => {
    const { broadcaster, messages } = createRecordingBroadcaster();

    publishRoom(broadcaster, room);

    expect(messages.map((message) => message.kind)).toEqual(['playerView', 'playerView']);
    expect(messages).toMatchObject([
      { connectionId: 'conn-0', view: { ownSeat: 0 } },
      { connectionId: 'conn-2', view: { ownSeat: 2 } },
    ]);
  });

  it('erwartet ab Spielstart einen vollständig besetzten Raum', () => {
    const { broadcaster } = createRecordingBroadcaster();

    expect(() => publishRoom(broadcaster, { ...room, seats: [room.seats[0], null, null] })).toThrow(
      'Sitz 1 ist trotz Spielstart frei',
    );
  });
});
