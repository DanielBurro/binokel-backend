import { z } from 'zod';
import type { GameEventBatch } from '../../../application/ports/outbound/game-broadcaster.port';
import type { PlayerView } from '../../../application/projection/player-view';
import type { RoomView } from '../../../application/projection/room-view';
import { RANKS, SUITS, type Card } from '../../../domain/cards/card';
import { GAME_MODES, type GameConfig, type SpecialRules } from '../../../domain/config/game-config';
import { MELD_KINDS, type Meld } from '../../../domain/melds/meld';
import {
  ABORT_REASONS,
  DABB_STATUSES,
  DECLARE_MODES,
  PHASES,
  ROUND_OUTCOMES,
} from '../../../domain/state/game-state';
import {
  INTENT_ERROR_CODES,
  type GameEvent,
  type LegalIntent,
  type PlayerIntent,
} from '../../../domain/state/intents';

/*
 * Vertrag mit dem Frontend. Client-Payloads werden streng validiert (unbekannte Felder führen
 * zu INVALID_PAYLOAD), Server-Events dokumentieren nur die Form. System-Intents (`startRound`,
 * `abortGame`) sind bewusst nicht enthalten, Clients können sie nie auslösen.
 */

type SchemaMeta = { readonly id: string };
const clientSchemas = z.registry<SchemaMeta>();
const serverSchemas = z.registry<SchemaMeta>();

function client<T extends z.ZodType>(id: string, schema: T): T {
  clientSchemas.add(schema, { id });
  return schema;
}

function server<T extends z.ZodType>(id: string, schema: T): T {
  serverSchemas.add(schema, { id });
  return schema;
}

function shared<T extends z.ZodType>(id: string, schema: T): T {
  return server(id, client(id, schema));
}

/**
 * `satisfies z.ZodType<T>` lässt bei Unions auch Teilmengen durch. Diese Hülle kompiliert nur,
 * wenn das Schema für jede Variante von T einen Zweig hat.
 */
function exhaustive<T extends { readonly type: string }>() {
  return <S extends z.ZodType<T>>(
    schema: S,
    ..._missing: [T['type']] extends [z.output<S>['type']]
      ? []
      : [Exclude<T['type'], z.output<S>['type']>]
  ): S => schema;
}

// Bausteine

export const MAX_DISPLAY_NAME_LENGTH = 24;

const seatSchema = z.int().nonnegative();
const versionSchema = z.int().nonnegative();
const displayNameSchema = z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH);
// Das genaue Format der Raum-ID legt der RoomService fest (Schritt 20).
const roomIdSchema = z.string().trim().min(1).max(16);
const sessionIdSchema = z.string().min(1).max(128);
const cardIdSchema = z.string().min(1).max(32);
const meldIdSchema = z.string().min(1).max(64);
/** Deckelt nur die Nachrichtengröße; die genaue Anzahl prüft die Engine. */
export const MAX_IDS_PER_INTENT = 48;

const specialRulesSchema = shared(
  'SpecialRules',
  z.strictObject({
    halbeStrafe: z.boolean().default(false),
    trumpfStichzwang: z.boolean().default(false),
    durch: z.boolean().default(false),
    untendurch: z.boolean().default(false),
    rufen: z.boolean().default(false),
    keinDabb: z.boolean().default(false),
    tauschen: z.boolean().default(false),
  }) satisfies z.ZodType<SpecialRules>,
);

/** Prüft nur die Form; ob die Engine die Konfiguration unterstützt, entscheidet validateGameConfig. */
const gameConfigSchema = shared(
  'GameConfig',
  z.strictObject({
    playerCount: z.literal([3, 4]),
    deckSize: z.literal([40, 48]),
    specialRules: specialRulesSchema.prefault({}),
    mode: z.enum(GAME_MODES).default('classic'),
  }) satisfies z.ZodType<GameConfig>,
);

/** Alle Züge einer Runde; die Engine setzt bisher Reizen und Dabb um (Schritte 14–18). */
const playerIntentSchema = client(
  'PlayerIntent',
  exhaustive<PlayerIntent>()(
    z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('bid'), amount: z.int() }),
      z.strictObject({ type: z.literal('pass') }),
      z.strictObject({ type: z.literal('takeDabb') }),
      z.strictObject({
        type: z.literal('discardToDabb'),
        cardIds: z.array(cardIdSchema).max(MAX_IDS_PER_INTENT),
      }),
      z.strictObject({
        type: z.literal('declare'),
        trump: z.enum(SUITS),
        mode: z.enum(DECLARE_MODES),
      }),
      z.strictObject({
        type: z.literal('submitMelds'),
        meldIds: z.array(meldIdSchema).max(MAX_IDS_PER_INTENT),
      }),
      z.strictObject({ type: z.literal('playCard'), cardId: cardIdSchema }),
      z.strictObject({ type: z.literal('readyForNextRound') }),
    ]),
  ),
);

// Client → Server

export const createRoomPayloadSchema = client(
  'CreateRoomPayload',
  z.strictObject({ displayName: displayNameSchema, config: gameConfigSchema }),
);

export const joinRoomPayloadSchema = client(
  'JoinRoomPayload',
  z.strictObject({ roomId: roomIdSchema, displayName: displayNameSchema }),
);

export const resumeSessionPayloadSchema = client(
  'ResumeSessionPayload',
  z.strictObject({ sessionId: sessionIdSchema }),
);

export const leaveRoomPayloadSchema = client('LeaveRoomPayload', z.strictObject({}));

/** `expectedVersion` fängt Doppelklicks und nach einem Reconnect erneut gesendete Intents ab. */
export const intentPayloadSchema = client(
  'IntentPayload',
  z.strictObject({ expectedVersion: versionSchema, intent: playerIntentSchema }),
);

// Acknowledgements

export const PROTOCOL_ERROR_CODES = [
  ...INTENT_ERROR_CODES,
  'STALE_STATE',
  'INVALID_PAYLOAD',
  'INVALID_CONFIG',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'SESSION_NOT_FOUND',
  'NOT_IN_ROOM',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

const errorAckSchema = server(
  'ErrorAck',
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(PROTOCOL_ERROR_CODES), message: z.string() }),
  }),
);

function ack<T extends z.ZodRawShape>(id: string, shape: T) {
  return server(
    id,
    z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), ...shape }), errorAckSchema]),
  );
}

export const roomJoinedAckSchema = ack('RoomJoinedAck', {
  roomId: roomIdSchema,
  seat: seatSchema,
  sessionId: sessionIdSchema,
});
export const sessionResumedAckSchema = ack('SessionResumedAck', {
  roomId: roomIdSchema,
  seat: seatSchema,
});
export const intentAckSchema = ack('IntentAck', { version: versionSchema });
export const leaveRoomAckSchema = ack('LeaveRoomAck', {});

// Server → Client

const cardSchema = server(
  'Card',
  z.object({
    id: z.string(),
    suit: z.enum(SUITS),
    rank: z.enum(RANKS),
    copy: z.literal([1, 2]),
  }) satisfies z.ZodType<Card>,
);

const meldSchema = server(
  'Meld',
  z.object({
    id: z.string(),
    kind: z.enum(MELD_KINDS),
    cards: z.array(cardSchema),
    points: z.int(),
  }) satisfies z.ZodType<Meld>,
);

const seatInfoSchema = z.object({ displayName: z.string(), connected: z.boolean() });

/** Lobby bis zum Spielstart; freie Sitze sind null. */
export const roomViewSchema = server(
  'RoomView',
  z.object({
    roomId: roomIdSchema,
    config: gameConfigSchema,
    seats: z.array(seatInfoSchema.nullable()),
  }) satisfies z.ZodType<RoomView>,
);

const partySchema = z.int().nonnegative();
const trickPlaySchema = z.object({ seat: seatSchema, card: cardSchema });

/** Erlaubte Züge eines Sitzes samt Spielraum; das Gegenstück zu `PlayerIntent`. */
const availableActionSchema = server(
  'AvailableAction',
  exhaustive<LegalIntent>()(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('bid'), min: z.int(), max: z.int(), step: z.int() }),
      z.object({ type: z.literal('pass') }),
      z.object({ type: z.literal('takeDabb') }),
      z.object({ type: z.literal('discardToDabb'), count: z.int().positive() }),
      z.object({ type: z.literal('declare'), modes: z.array(z.enum(DECLARE_MODES)) }),
      z.object({ type: z.literal('submitMelds'), melds: z.array(meldSchema) }),
      z.object({ type: z.literal('playCard'), cardIds: z.array(z.string()) }),
      z.object({ type: z.literal('readyForNextRound') }),
    ]),
  ),
);

/** Auf die ganze Runde ausgelegt; die Felder ab `declaration` füllen die Schritte 14–18. */
export const playerViewSchema = server(
  'PlayerView',
  z.object({
    version: versionSchema,
    phase: z.enum(PHASES),
    config: gameConfigSchema,
    ownSeat: seatSchema,
    seats: z.array(
      seatInfoSchema.extend({
        seat: seatSchema,
        party: partySchema,
        handSize: z.int().nonnegative(),
      }),
    ),
    hand: z.array(cardSchema),
    dealer: seatSchema,
    forehand: seatSchema.nullable(),
    bidding: z
      .object({
        highestBid: z.int(),
        highestBidder: seatSchema,
        passed: z.array(seatSchema),
      })
      .nullable(),
    declarer: seatSchema.nullable(),
    dabb: z
      .object({
        size: z.int().nonnegative(),
        status: z.enum(DABB_STATUSES),
        cards: z.array(cardSchema).nullable(),
      })
      .nullable(),
    declaration: z.object({ trump: z.enum(SUITS), mode: z.enum(DECLARE_MODES) }).nullable(),
    melds: z.array(z.object({ melds: z.array(meldSchema), points: z.int() }).nullable()),
    trick: z.object({ plays: z.array(trickPlaySchema) }).nullable(),
    lastTrick: z.object({ plays: z.array(trickPlaySchema), winner: seatSchema }).nullable(),
    roundResult: z
      .object({
        outcome: z.enum(ROUND_OUTCOMES),
        parties: z.array(
          z.object({
            trickPoints: z.int(),
            meldPoints: z.int(),
            meldsCounted: z.boolean(),
            delta: z.int(),
          }),
        ),
      })
      .nullable(),
    readySeats: z.array(seatSchema),
    activeSeat: seatSchema.nullable(),
    scores: z.array(z.int()),
    abortReason: z.enum(ABORT_REASONS).nullable(),
    winners: z.array(partySchema).nullable(),
    availableActions: z.array(availableActionSchema),
  }) satisfies z.ZodType<PlayerView>,
);

/** Nur öffentliche Ereignisse; alles Private kommt über `game:state`. */
const gameEventSchema = server(
  'GameEvent',
  exhaustive<GameEvent>()(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('roundStarted'), dealer: seatSchema, forehand: seatSchema }),
      z.object({ type: z.literal('bidPlaced'), seat: seatSchema, amount: z.int() }),
      z.object({ type: z.literal('passed'), seat: seatSchema }),
      z.object({ type: z.literal('biddingWon'), declarer: seatSchema, bid: z.int() }),
      z.object({ type: z.literal('dabbTaken'), seat: seatSchema }),
      z.object({ type: z.literal('dabbDiscarded'), seat: seatSchema }),
      z.object({
        type: z.literal('declared'),
        seat: seatSchema,
        trump: z.enum(SUITS),
        mode: z.enum(DECLARE_MODES),
      }),
      z.object({
        type: z.literal('meldsSubmitted'),
        seat: seatSchema,
        melds: z.array(meldSchema),
        points: z.int(),
      }),
      z.object({ type: z.literal('cardPlayed'), seat: seatSchema, card: cardSchema }),
      z.object({ type: z.literal('trickWon'), winner: seatSchema }),
      z.object({ type: z.literal('roundScored'), outcome: z.enum(ROUND_OUTCOMES) }),
      z.object({ type: z.literal('playerReady'), seat: seatSchema }),
      z.object({ type: z.literal('gameFinished'), winners: z.array(partySchema) }),
      z.object({ type: z.literal('gameAborted'), reason: z.enum(ABORT_REASONS) }),
    ]),
  ),
);

export const gameEventsSchema = server(
  'GameEvents',
  z.object({
    version: versionSchema,
    events: z.array(gameEventSchema),
  }) satisfies z.ZodType<GameEventBatch>,
);

// Ereignisnamen

export const CLIENT_EVENTS = {
  createRoom: { name: 'room:create', payload: createRoomPayloadSchema, ack: roomJoinedAckSchema },
  joinRoom: { name: 'room:join', payload: joinRoomPayloadSchema, ack: roomJoinedAckSchema },
  leaveRoom: { name: 'room:leave', payload: leaveRoomPayloadSchema, ack: leaveRoomAckSchema },
  resumeSession: {
    name: 'session:resume',
    payload: resumeSessionPayloadSchema,
    ack: sessionResumedAckSchema,
  },
  intent: { name: 'game:intent', payload: intentPayloadSchema, ack: intentAckSchema },
} as const;

export const SERVER_EVENTS = {
  roomState: { name: 'room:state', payload: roomViewSchema },
  gameState: { name: 'game:state', payload: playerViewSchema },
  gameEvents: { name: 'game:events', payload: gameEventsSchema },
} as const;

export type CreateRoomPayload = z.output<typeof createRoomPayloadSchema>;
export type JoinRoomPayload = z.output<typeof joinRoomPayloadSchema>;
export type ResumeSessionPayload = z.output<typeof resumeSessionPayloadSchema>;
export type IntentPayload = z.output<typeof intentPayloadSchema>;

// Export für das Frontend (`npm run protocol:export`)

function idOf(schema: z.ZodType): string | undefined {
  return clientSchemas.get(schema)?.id ?? serverSchemas.get(schema)?.id;
}

/** Client-Schemas in Eingabeform (Defaults optional), Server-Schemas in Ausgabeform. */
export function protocolJsonSchema() {
  return {
    clientEvents: Object.fromEntries(
      Object.values(CLIENT_EVENTS).map(({ name, payload, ack }) => [
        name,
        { payload: idOf(payload), ack: idOf(ack) },
      ]),
    ),
    serverEvents: Object.fromEntries(
      Object.values(SERVER_EVENTS).map(({ name, payload }) => [name, { payload: idOf(payload) }]),
    ),
    clientSchemas: z.toJSONSchema(clientSchemas, { io: 'input' }),
    serverSchemas: z.toJSONSchema(serverSchemas),
  };
}
