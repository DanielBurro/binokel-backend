import type { z } from 'zod';
import type { ConnectionId, SessionId } from '../../../application/model/room';
import type { CreateRoomPort } from '../../../application/ports/inbound/create-room.port';
import type { DisconnectPort } from '../../../application/ports/inbound/disconnect.port';
import type { ExecuteMovePort } from '../../../application/ports/inbound/execute-move.port';
import type { JoinRoomPort } from '../../../application/ports/inbound/join-room.port';
import type { LeaveRoomPort } from '../../../application/ports/inbound/leave-room.port';
import type { ResumeSessionPort } from '../../../application/ports/inbound/resume-session.port';
import type { ServiceFailure } from '../../../application/ports/inbound/service-error';
import { CLIENT_EVENTS, type ProtocolErrorCode } from './protocol';
import type { BinokelServer, BinokelSocket, ClientEventName } from './socket-io-server';

export interface InboundPorts {
  readonly rooms: CreateRoomPort &
    JoinRoomPort &
    ResumeSessionPort &
    LeaveRoomPort &
    DisconnectPort;
  readonly moves: ExecuteMovePort;
}

export const ERROR_MESSAGES: Readonly<Record<ProtocolErrorCode, string>> = {
  INVALID_ACTOR: 'Dieser Zug ist für diesen Sitz nicht erlaubt.',
  WRONG_PHASE: 'Der Zug ist in der aktuellen Spielphase nicht möglich.',
  NOT_YOUR_TURN: 'Du bist nicht am Zug.',
  BID_TOO_LOW: 'Das Gebot liegt unter dem Mindestgebot.',
  BID_NOT_IN_STEPS: 'Gebote müssen in Zehnerschritten erfolgen.',
  BID_ABOVE_LIMIT: 'Das Gebot liegt über der Obergrenze.',
  INVALID_DECK: 'Das Kartenblatt ist ungültig.',
  STALE_STATE: 'Der Spielstand hat sich inzwischen geändert.',
  INVALID_PAYLOAD: 'Die Nachricht entspricht nicht dem Protokoll.',
  INVALID_CONFIG: 'Diese Spielkonfiguration wird nicht unterstützt.',
  ROOM_NOT_FOUND: 'Raum nicht gefunden.',
  ROOM_FULL: 'Der Raum ist voll.',
  SESSION_NOT_FOUND: 'Sitzung nicht gefunden.',
  NOT_IN_ROOM: 'Du bist in keinem Raum.',
  RATE_LIMITED: 'Zu viele Nachrichten, bitte kurz warten.',
  INTERNAL_ERROR: 'Interner Serverfehler.',
};

interface ErrorAck {
  readonly ok: false;
  readonly error: { readonly code: ProtocolErrorCode; readonly message: string };
}

export function errorAck(code: ProtocolErrorCode, details: readonly string[] = []): ErrorAck {
  const message = ERROR_MESSAGES[code];
  return {
    ok: false,
    error: { code, message: details.length > 0 ? `${message} (${details.join('; ')})` : message },
  };
}

/** Kompiliert nur, solange jeder Fehlercode der Services auch im Protokoll steht. */
function fromService({ code, details }: ServiceFailure): ErrorAck {
  return errorAck(code, details);
}

interface ClientEvent<P extends z.ZodType, A extends z.ZodType> {
  readonly name: ClientEventName;
  readonly payload: P;
  readonly ack: A;
}

/**
 * Registriert einen Handler mit Ack. Die Payload wird gegen das Protokoll geprüft, Ausnahmen
 * werden zu INTERNAL_ERROR, damit kein Client ohne Antwort bleibt.
 */
function handle<P extends z.ZodType, A extends z.ZodType>(
  socket: BinokelSocket,
  event: ClientEvent<P, A>,
  run: (payload: z.output<P>) => Promise<z.output<A>>,
): void {
  socket.on(event.name, (first, second) => {
    // Ohne Payload kommt das Ack als erstes Argument an.
    const [raw, ack] =
      typeof first === 'function' && second === undefined ? [undefined, first] : [first, second];
    // Ohne Ack könnte der Client keine Antwort empfangen.
    if (typeof ack !== 'function') return;
    void respond(event.payload, raw, run).then((response) => ack(response));
  });
}

async function respond<P extends z.ZodType, R>(
  schema: P,
  raw: unknown,
  run: (payload: z.output<P>) => Promise<R>,
): Promise<R | ErrorAck> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return errorAck(
      'INVALID_PAYLOAD',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`),
    );
  }
  try {
    return await run(parsed.data);
  } catch (error) {
    console.error('[Socket] Unerwarteter Fehler', error);
    return errorAck('INTERNAL_ERROR');
  }
}

/** Übersetzt Socket.IO-Nachrichten in Aufrufe der Inbound-Ports. */
export function attachSocketIoAdapter(io: BinokelServer, { rooms, moves }: InboundPorts): void {
  /** Ersetzt ein Resume eine noch offene Verbindung, wird diese getrennt. */
  function release(connectionId: ConnectionId): void {
    const replaced = io.sockets.sockets.get(connectionId);
    if (replaced === undefined) return;
    replaced.data.sessionId = null;
    replaced.disconnect(true);
  }

  io.on('connection', (socket) => {
    socket.data.sessionId = null;

    /** Ein Socket hält höchstens eine Sitzung; eine vorherige gilt danach als getrennt. */
    async function bind(sessionId: SessionId): Promise<void> {
      const previous = socket.data.sessionId;
      socket.data.sessionId = sessionId;
      if (previous !== null && previous !== sessionId) {
        await rooms.disconnect({ sessionId: previous, connectionId: socket.id });
      }
    }

    handle(socket, CLIENT_EVENTS.createRoom, async ({ displayName, config }) => {
      const result = await rooms.createRoom({ displayName, config, connectionId: socket.id });
      if (!result.ok) return fromService(result);
      await bind(result.sessionId);
      return {
        ok: true as const,
        roomId: result.roomId,
        seat: result.seat,
        sessionId: result.sessionId,
      };
    });

    handle(socket, CLIENT_EVENTS.joinRoom, async ({ roomId, displayName }) => {
      const result = await rooms.joinRoom({ roomId, displayName, connectionId: socket.id });
      if (!result.ok) return fromService(result);
      await bind(result.sessionId);
      return {
        ok: true as const,
        roomId: result.roomId,
        seat: result.seat,
        sessionId: result.sessionId,
      };
    });

    handle(socket, CLIENT_EVENTS.resumeSession, async ({ sessionId }) => {
      const result = await rooms.resumeSession({ sessionId, connectionId: socket.id });
      if (!result.ok) return fromService(result);
      if (result.replacedConnectionId !== null) release(result.replacedConnectionId);
      await bind(sessionId);
      return { ok: true as const, roomId: result.roomId, seat: result.seat };
    });

    handle(socket, CLIENT_EVENTS.leaveRoom, async () => {
      const { sessionId } = socket.data;
      if (sessionId === null) return errorAck('NOT_IN_ROOM');
      socket.data.sessionId = null;
      const result = await rooms.leaveRoom({ sessionId });
      return result.ok ? { ok: true as const } : fromService(result);
    });

    handle(socket, CLIENT_EVENTS.intent, async ({ expectedVersion, intent }) => {
      const { sessionId } = socket.data;
      if (sessionId === null) return errorAck('NOT_IN_ROOM');
      const result = await moves.executeMove({ sessionId, expectedVersion, intent });
      return result.ok ? { ok: true as const, version: result.version } : fromService(result);
    });

    socket.on('disconnect', () => {
      const { sessionId } = socket.data;
      if (sessionId === null) return;
      rooms.disconnect({ sessionId, connectionId: socket.id }).catch((error: unknown) => {
        console.error('[Socket] Fehler beim Trennen', error);
      });
    });
  });
}
