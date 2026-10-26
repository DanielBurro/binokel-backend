import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { protocolJsonSchema } from '../src/adapters/inbound/websocket/protocol';

// Das Frontend-Repo erzeugt seine Typen aus dieser Datei.
const target = process.argv[2] ?? 'protocol/protocol.schema.json';
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(protocolJsonSchema(), null, 2)}\n`);
console.log(`Protokoll-Schema geschrieben: ${target}`);
