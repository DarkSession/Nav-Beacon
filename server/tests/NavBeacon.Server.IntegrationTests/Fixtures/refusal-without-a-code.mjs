// A command that refuses a record and states a code of the wrong kind.
//
// The server reads a code only where it is a string, so this answers the same
// as a refusal that states no code at all. Reading it regardless would end the
// request in an unhandled failure instead of the refusal FR-012 states.
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ ok: false, code: 12 }));
});
