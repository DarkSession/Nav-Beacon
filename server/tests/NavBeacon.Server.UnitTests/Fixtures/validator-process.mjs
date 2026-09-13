const mode = process.argv[2];

if (mode === 'timeout') {
  setTimeout(() => process.stdout.write('{"ok":true}'), 10_000);
} else if (mode === 'crash') {
  process.exit(7);
} else if (mode === 'exact') {
  const prefix = '{"ok":true,"padding":"';
  const suffix = '"}';
  process.stdout.write(prefix + 'x'.repeat(65_536 - prefix.length - suffix.length) + suffix);
} else if (mode === 'over') {
  const prefix = '{"ok":true,"padding":"';
  const suffix = '"}';
  process.stdout.write(prefix + 'x'.repeat(65_537 - prefix.length - suffix.length) + suffix);
} else if (mode === 'flood') {
  // Far more than one pipe buffer holds, so the command stays alive until the
  // reader drains it. Waiting for exit before reading would deadlock here.
  process.stdout.write('{"ok":true,"padding":"' + 'x'.repeat(4_000_000) + '"}');
} else if (mode === 'empty') {
  process.exit(0);
} else if (mode === 'array') {
  // Well-formed JSON that is not the answer document. Every field is read off
  // an object, so the root is taken under its kind before any of them.
  process.stdout.write('[]');
} else {
  process.stdin.resume();
  process.stdin.on('end', () =>
    process.stdout.write('{"ok":false,"code":"invalid-record","index":2}'),
  );
}
