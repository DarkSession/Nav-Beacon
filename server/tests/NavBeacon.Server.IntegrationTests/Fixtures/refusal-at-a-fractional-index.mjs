// A command that refuses a candidate and states an index that is not a whole
// number. The server takes an index only where the number fits one, so this
// answers the same as a refusal that states no index at all: no projection.
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ ok: false, index: 1.5 }));
});
