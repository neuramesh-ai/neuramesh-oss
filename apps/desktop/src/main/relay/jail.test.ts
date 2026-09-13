// The jail's behaviour was verified against a real pty in the real machine image under
// gVisor (cd /etc bounced, cd sub allowed, message shown). These assertions exist so that
// result cannot silently rot: every one of them is a line whose removal would make the jail
// stop confining while still spawning a perfectly working shell — a failure with no symptom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { makeJail } from './jail';

test('the rcfile confines the shell and survives symlinked roots', () => {
  const j = makeJail('/tmp/nm-jail-root');
  const rc = j.args[j.args.indexOf('--rcfile') + 1]!;
  const body = readFileSync(rc, 'utf8');

  // resolved ONCE with pwd -P: comparing against an unresolved root makes a symlinked path
  // (/tmp -> /private/tmp) read as an escape and bounces people out of their own workspace
  assert.match(body, /NMJAIL_REAL="\$\(cd "\$NMJAIL".*pwd -P\)"/);
  // bash has no chpwd hook — PROMPT_COMMAND is the equivalent, and without it the guard is
  // defined and never called, which looks identical to a working jail until someone cd's out
  assert.match(body, /PROMPT_COMMAND=__nm_jail/);
  // the prefix match must accept the root itself AND its children, or `cd` into a legal
  // subdirectory bounces
  assert.match(body, /"\$NMJAIL_REAL"\/\*\|"\$NMJAIL_REAL"\//);
  assert.match(body, /confined to the task workspace/);
  j.cleanup();
});

test('it spawns bash interactively — --rcfile is ignored otherwise', () => {
  const j = makeJail('/tmp/nm-jail-root');
  assert.equal(j.shell, '/bin/bash');
  assert.ok(j.args.includes('-i'), 'a non-interactive bash ignores --rcfile, so the jail would never load');
  assert.equal(j.env['NMJAIL'], '/tmp/nm-jail-root');
  j.cleanup();
});

test('cleanup removes the rcfile directory', () => {
  const j = makeJail('/tmp/nm-jail-root');
  const rc = j.args[j.args.indexOf('--rcfile') + 1]!;
  assert.ok(existsSync(rc));
  j.cleanup();
  assert.ok(!existsSync(rc), 'a leaked rcfile per terminal fills the machine over a long session');
});
