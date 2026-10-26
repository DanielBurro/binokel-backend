import { loadEnv } from './config/env';
import { createBinokelServer } from './server';

/** Spätestens danach wird der Prozess beendet, auch wenn Verbindungen hängen. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const env = loadEnv();
const server = createBinokelServer(env);

server.listen(env.port).then(
  (port) => console.log(`[Binokel-Server] Läuft auf Port ${port}`),
  (error: unknown) => {
    console.error('[Binokel-Server] Start fehlgeschlagen', error);
    process.exit(1);
  },
);

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Binokel-Server] ${signal} empfangen, fahre herunter`);
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  server.close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error('[Binokel-Server] Fehler beim Herunterfahren', error);
      process.exit(1);
    },
  );
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
