import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { ClockPort } from './application/ports/outbound/clock.port';
import type { IdGeneratorPort } from './application/ports/outbound/id-generator.port';
import type { ShufflerPort } from './application/ports/outbound/shuffler.port';
import { createGameService } from './application/services/game-service';
import { createRoomService } from './application/services/room-service';
import { createRoomStore } from './application/services/room-store';
import { attachSocketIoAdapter } from './adapters/inbound/websocket/socket-io-adapter';
import { createSocketIoServer } from './adapters/inbound/websocket/socket-io-server';
import { createCryptoIdGenerator } from './adapters/outbound/crypto-id-generator';
import { createCryptoShuffler } from './adapters/outbound/crypto-shuffler';
import { createInMemoryRoomRepository } from './adapters/outbound/in-memory-room-repository';
import { createSocketIoBroadcaster } from './adapters/outbound/socket-io-broadcaster';
import { systemClock } from './adapters/outbound/system-clock';
import type { Env } from './config/env';

/** Austauschbare Abhängigkeiten, z. B. ein deterministischer Shuffler in Tests. */
export interface ServerOverrides {
  readonly shuffler?: ShufflerPort;
  readonly ids?: IdGeneratorPort;
  readonly clock?: ClockPort;
}

export interface BinokelServer {
  /** Liefert den tatsächlich gebundenen Port (relevant bei Port 0). */
  listen(port: number, host?: string): Promise<number>;
  /** Trennt alle Sockets und schließt den HTTP-Server. */
  close(): Promise<void>;
}

/** Verdrahtet Adapter, Services und Ports; enthält selbst keine Logik. */
export function createBinokelServer(
  env: Pick<Env, 'corsOrigins'>,
  overrides: ServerOverrides = {},
): BinokelServer {
  const app = express();
  const httpServer = http.createServer(app);
  const io = createSocketIoServer(httpServer, env);

  const broadcaster = createSocketIoBroadcaster(io);
  const store = createRoomStore(createInMemoryRoomRepository(), overrides.clock ?? systemClock);
  const games = createGameService({
    store,
    broadcaster,
    shuffler: overrides.shuffler ?? createCryptoShuffler(),
  });
  const rooms = createRoomService({
    store,
    ids: overrides.ids ?? createCryptoIdGenerator(),
    broadcaster,
    games,
  });
  attachSocketIoAdapter(io, { rooms, moves: games });

  return {
    listen(port, host) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve((httpServer.address() as AddressInfo).port);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        io.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
