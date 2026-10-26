import { z } from 'zod';
import type { GameEventBatch } from '../../../application/ports/outbound/game-broadcaster.port';
import type { PlayerView } from '../../../application/projection/player-view';
import type { RoomView } from '../../../application/projection/room-view';
import { RANKS, SUITS, type Card } from '../../../domain/cards/card';
import { GAME_MODES, type GameConfig, type SpecialRules } from '../../../domain/config/game-config';
import { ABORT_REASONS, PHASES } from '../../../domain/state/game-state';
import {
  INTENT_ERROR_CODES,
  type GameEvent,
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

// Bausteine

export const MAX_DISPLAY_NAME_LENGTH = 24;

const seatSchema = z.int().nonnegative();
const versionSchema = z.int().nonnegative();
const displayNameSchema = z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH);
// Das genaue Format der Raum-ID legt der RoomService fest (Schritt 20).
const roomIdSchema = z.string().trim().min(1).max(16);
const sessionIdSchema = z.string().min(1).max(128);

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

const playerIntentSchema = client(
  'PlayerIntent',
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('bid'), amount: z.int() }),
    z.strictObject({ type: z.literal('pass') }),
  ]) satisfies z.ZodType<PlayerIntent>,
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
        party: z.int().nonnegative(),
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
    activeSeat: seatSchema.nullable(),
    scores: z.array(z.int()),
    abortReason: z.enum(ABORT_REASONS).nullable(),
    availableActions: z.object({
      intents: z.array(z.enum(['bid', 'pass'])),
      bidRange: z.object({ min: z.int(), max: z.int(), step: z.int() }).nullable(),
    }),
  }) satisfies z.ZodType<PlayerView>,
);

/** Nur öffentliche Ereignisse; alles Private kommt über `game:state`. */
const gameEventSchema = server(
  'GameEvent',
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('roundStarted'), dealer: seatSchema, forehand: seatSchema }),
    z.object({ type: z.literal('bidPlaced'), seat: seatSchema, amount: z.int() }),
    z.object({ type: z.literal('passed'), seat: seatSchema }),
    z.object({ type: z.literal('biddingWon'), declarer: seatSchema, bid: z.int() }),
    z.object({ type: z.literal('gameAborted'), reason: z.enum(ABORT_REASONS) }),
  ]) satisfies z.ZodType<GameEvent>,
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
