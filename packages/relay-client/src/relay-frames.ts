// THE PURE HALF OF THE BROWSER RELAY CLIENT — no sockets, no window, so it is testable.
//
// Everything here is the part that is easy to get subtly wrong and impossible to notice:
// byte encoding across frame boundaries, and turning a close code into a sentence.

/** base64 → text, but STREAMING.
 *
 *  A pty emits BYTES. The relay carries them base64'd, chopped at whatever boundary the
 *  socket felt like. A multi-byte character therefore SPLITS across frames routinely —
 *  any box-drawing character, any emoji in a commit message, any accented name. Decoding
 *  each frame independently turns those into replacement characters, and the corruption is
 *  intermittent and load-dependent, which is the worst kind to chase later.
 *
 *  TextDecoder with `{ stream: true }` holds the partial sequence between calls, so one
 *  decoder per channel is what makes `git log` render instead of speckle. */
export function makeDecoder(): (b64: string) => string {
  const dec = new TextDecoder('utf-8');
  return (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return dec.decode(bytes, { stream: true });
  };
}

/** text → base64. btoa is LATIN-1 ONLY: it throws on any code point above 255, so typing
 *  an accented character into a terminal would raise InvalidCharacterError rather than
 *  reaching the shell. Encode to UTF-8 bytes first. */
export function encodeB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** the relay's coded refusals, said as something a person can act on. Mirrors CLOSE in
 *  packages/relay/src/protocol.ts — kept as literals so the browser bundle does not pull a
 *  node package in for seven integers. */
export function closeReason(code: number): string {
  switch (code) {
    case 4401: return 'This machine did not accept the connection. Try reloading.';
    case 4403: return 'You do not have access to this workspace machine.';
    case 4404: return 'The machine is asleep. Start it, then open the terminal again.';
    case 4409: return 'This machine reconnected somewhere else.';
    case 4410: return 'The machine went away.';
    case 1013: return 'Cannot reach NeuraMesh to check permissions. Try again shortly.';
    case 1008: return 'The relay refused the connection.';
    // EVERY OTHER CODE CARRIES ITS NUMBER. The bare sentence was indistinguishable from the four
    // named refusals above, so a report of "The connection closed" ruled nothing in or out — which
    // is exactly where one stalled (George, 2026-09-06). 1006 is a handshake that never completed;
    // 1000 and 1001 are an ordinary end. Naming the code is the difference between a symptom and a
    // cause, and it costs one number.
    default: return `The connection closed (${code}).`;
  }
}

/** what the pane prints when a session cannot start or ends badly. \r\n because a pty
 *  speaks CRLF and these bytes go straight to the emulator. Yellow, because this is the
 *  same "nm:" voice the desktop terminal already uses for its own notes. */
export const notice = (text: string): string => `\r\n\x1b[33mnm:\x1b[0m \x1b[2m${text}\x1b[0m\r\n`;
