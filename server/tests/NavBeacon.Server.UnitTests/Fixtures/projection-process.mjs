// A stand-in for the journal mode of the one Node command. The request's locale
// names the answer, so one fixture covers every bound the caller enforces.
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const bound = 4 * 1024 * 1024;

if (request.locale === 'timeout') {
  setTimeout(() => process.stdout.write('{"ok":true,"ships":[]}'), 10_000);
} else if (request.locale === 'flood') {
  process.stdout.write(pad(bound + 1));
} else if (request.locale === 'exact') {
  process.stdout.write(pad(bound));
} else if (request.locale === 'garbage') {
  process.stdout.write('not json');
} else if (request.locale === 'crash') {
  process.exit(3);
} else if (request.locale === 'short') {
  process.stdout.write('{"ok":true,"code":null,"index":null,"ships":[]}');
} else {
  process.stdout.write('{"ok":true,"code":null,"index":null}');
}

function pad(size) {
  const prefix =
    '{"ok":false,"code":"package-refused","index":0,"refusal":{"code":"invalidModule","constraint":null,"path":null,"message":null},"ships":[],"padding":"';
  const suffix = '"}';
  return prefix + 'x'.repeat(size - prefix.length - suffix.length) + suffix;
}
