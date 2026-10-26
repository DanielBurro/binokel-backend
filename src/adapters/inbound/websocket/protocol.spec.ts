import { describe, expect, it } from 'vitest';
import { projectStateFor } from '../../../application/projection/project-state';
import { buildDeck } from '../../../domain/cards/deck';
import { NO_SPECIAL_RULES, type GameConfig } from '../../../domain/config/game-config';
import { applyIntent } from '../../../domain/state/apply-intent';
import { createGame, type GameState } from '../../../domain/state/game-state';
import { SYSTEM, type Actor, type GameEvent, type Intent } from '../../../domain/state/intents';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  createRoomPayloadSchema,
  gameEventsSchema,
  intentAckSchema,
  intentPayloadSchema,
  joinRoomPayloadSchema,
  leaveRoomPayloadSchema,
  playerViewSchema,
  protocolJsonSchema,
  resumeSessionPayloadSchema,
} from './protocol';

const config: GameConfig = {
  playerCount: 3,
  deckSize: 40,
  specialRules: NO_SPECIAL_RULES,
  mode: 'classic',
};

const seats = [0, 1, 2].map((seat) => ({ displayName: `Spieler ${seat}`, connected: true }));

/** Spielt die Züge und sammelt dabei alle Zustände und Ereignisse. */
function play(...moves: [Actor, Intent][]): { states: GameState[]; events: GameEvent[] } {
  const states = [createGame(config, 0)];
  const events: GameEvent[] = [];
  for (const [actor, intent] of moves) {
    const result = applyIntent(states[states.length - 1], actor, intent);
    if (!result.ok) throw new Error(`Unerwarteter Fehler ${result.code}`);
    states.push(result.state);
    events.push(...result.events);
  }
  return { states, events };
}

const fullBiddingRound = play(
  [SYSTEM, { type: 'startRound', shuffledDeck: buildDeck(40) }],
  [2, { type: 'bid', amount: 160 }],
  [0, { type: 'pass' }],
  [1, { type: 'pass' }],
  [SYSTEM, { type: 'abortGame', reason: 'PLAYER_LEFT' }],
);

describe('Client-Payloads', () => {
  it('ergänzt beim Erstellen fehlende Sonderregeln und den Modus', () => {
    const payload = createRoomPayloadSchema.parse({
      displayName: '  Anna ',
      config: { playerCount: 4, deckSize: 48 },
    });

    expect(payload).toEqual({
      displayName: 'Anna',
      config: { playerCount: 4, deckSize: 48, specialRules: NO_SPECIAL_RULES, mode: 'classic' },
    });
  });

  it.each([
    ['leerer Name', { displayName: '   ', config }],
    ['zu langer Name', { displayName: 'x'.repeat(25), config }],
    ['ungültige Spielerzahl', { displayName: 'Anna', config: { ...config, playerCount: 5 } }],
    [
      'unbekannte Sonderregel',
      { displayName: 'Anna', config: { ...config, specialRules: { x: true } } },
    ],
    ['unbekanntes Feld', { displayName: 'Anna', config, admin: true }],
  ])('weist beim Erstellen ab: %s', (_, payload) => {
    expect(createRoomPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('prüft Beitritt, Wiederaufnahme und Verlassen', () => {
    expect(joinRoomPayloadSchema.parse({ roomId: 'K7QX', displayName: 'Ben' })).toEqual({
      roomId: 'K7QX',
      displayName: 'Ben',
    });
    expect(joinRoomPayloadSchema.safeParse({ roomId: '', displayName: 'Ben' }).success).toBe(false);
    expect(resumeSessionPayloadSchema.safeParse({ sessionId: 'abc' }).success).toBe(true);
    expect(resumeSessionPayloadSchema.safeParse({}).success).toBe(false);
    expect(leaveRoomPayloadSchema.safeParse({}).success).toBe(true);
    expect(leaveRoomPayloadSchema.safeParse({ seat: 1 }).success).toBe(false);
  });

  it('nimmt Gebot und Passen mit erwarteter Version an', () => {
    expect(
      intentPayloadSchema.parse({ expectedVersion: 3, intent: { type: 'bid', amount: 170 } }),
    ).toEqual({ expectedVersion: 3, intent: { type: 'bid', amount: 170 } });
    expect(
      intentPayloadSchema.safeParse({ expectedVersion: 0, intent: { type: 'pass' } }).success,
    ).toBe(true);
  });

  it.each([
    [
      'System-Intent startRound',
      { expectedVersion: 0, intent: { type: 'startRound', shuffledDeck: [] } },
    ],
    [
      'System-Intent abortGame',
      { expectedVersion: 0, intent: { type: 'abortGame', reason: 'PLAYER_LEFT' } },
    ],
    ['ohne Version', { intent: { type: 'pass' } }],
    ['negative Version', { expectedVersion: -1, intent: { type: 'pass' } }],
    ['Gebot ohne Ganzzahl', { expectedVersion: 1, intent: { type: 'bid', amount: 170.5 } }],
    ['Passen mit Zusatzfeld', { expectedVersion: 1, intent: { type: 'pass', seat: 0 } }],
  ])('weist Intents ab: %s', (_, payload) => {
    expect(intentPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('Server-Events', () => {
  it('beschreibt jede PlayerView, die die Projektion erzeugt', () => {
    for (const state of fullBiddingRound.states) {
      for (const seat of [0, 1, 2]) {
        const view = projectStateFor(state, seat, seats);
        expect(playerViewSchema.parse(view)).toEqual(view);
      }
    }
  });

  it('beschreibt jedes Ereignis, das die Engine erzeugt', () => {
    const { events } = fullBiddingRound;

    expect(new Set(events.map((event) => event.type))).toEqual(
      new Set(['roundStarted', 'bidPlaced', 'passed', 'biddingWon', 'gameAborted']),
    );
    expect(gameEventsSchema.parse({ version: 5, events })).toEqual({ version: 5, events });
  });

  it('unterscheidet erfolgreiche und fehlgeschlagene Acknowledgements', () => {
    expect(intentAckSchema.parse({ ok: true, version: 4 })).toEqual({ ok: true, version: 4 });
    expect(
      intentAckSchema.parse({ ok: false, error: { code: 'STALE_STATE', message: 'Veraltet' } }),
    ).toEqual({ ok: false, error: { code: 'STALE_STATE', message: 'Veraltet' } });
    expect(
      intentAckSchema.safeParse({ ok: false, error: { code: 'UNKNOWN', message: '' } }).success,
    ).toBe(false);
  });
});

describe('protocolJsonSchema', () => {
  const exported = protocolJsonSchema();

  it('ordnet jedem Ereignis exportierte Schemas zu', () => {
    for (const { name } of Object.values(CLIENT_EVENTS)) {
      const { payload, ack } = exported.clientEvents[name];
      expect(exported.clientSchemas.schemas[payload!]).toBeDefined();
      expect(exported.serverSchemas.schemas[ack!]).toBeDefined();
    }
    for (const { name } of Object.values(SERVER_EVENTS)) {
      expect(exported.serverSchemas.schemas[exported.serverEvents[name].payload!]).toBeDefined();
    }
  });

  it('macht Defaults für Clients optional und für Server-Daten verpflichtend', () => {
    const required = (schemas: typeof exported.clientSchemas) =>
      (schemas.schemas.GameConfig as { required: string[] }).required;

    expect(required(exported.clientSchemas)).toEqual(['playerCount', 'deckSize']);
    expect(required(exported.serverSchemas)).toEqual([
      'playerCount',
      'deckSize',
      'specialRules',
      'mode',
    ]);
  });

  it('ist als JSON serialisierbar', () => {
    expect(() => JSON.parse(JSON.stringify(exported))).not.toThrow();
  });
});
