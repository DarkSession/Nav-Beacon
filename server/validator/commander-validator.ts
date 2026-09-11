import { writeSync } from 'node:fs';
import { parseRemoteRecord } from '../../src/app/domain/records/remote-record';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

let input: unknown;
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  write({ ok: false, code: 'invalid-json', index: null });
  process.exit(0);
}

if (!isRecordRequest(input)) {
  write({ ok: false, code: 'invalid-request', index: null });
  process.exit(0);
}

for (const [index, record] of input.records.entries()) {
  if (!parseRemoteRecord(record).ok) {
    write({ ok: false, code: 'invalid-record', index });
    process.exit(0);
  }
}

write({ ok: true, code: null, index: null });

function isRecordRequest(value: unknown): value is { readonly records: readonly unknown[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return Object.keys(request).length === 1 && Array.isArray(request['records']);
}

function write(result: {
  readonly ok: boolean;
  readonly code: string | null;
  readonly index: number | null;
}): void {
  // Written synchronously. `process.exit` follows immediately, and a pipe write
  // that the runtime queued would be lost before it reaches the caller.
  writeSync(1, JSON.stringify(result));
}
