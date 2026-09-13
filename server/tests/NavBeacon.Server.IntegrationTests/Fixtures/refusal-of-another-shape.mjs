// A command that refuses a record and states a code and an index of the wrong
// kinds. The server reads a code only where it is a string and an index only
// where the number fits a whole one, so this answers the same as a refusal that
// states neither. Reading them regardless would end the request in an unhandled
// failure instead of the refusal FR-012 states.
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ ok: false, code: 12, index: 1.5 }));
});
