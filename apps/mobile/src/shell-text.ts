// WHAT iOS DOES TO A COMMAND ON ITS WAY TO A SHELL (S8).
//
// The system keyboard's smart punctuation rewrites as you type: `--version` becomes `—version`
// (one em dash), a quoted path gets curly quotes, `...` becomes an ellipsis. On a phone that is
// correct for prose and silently wrong for a shell — `claude —version` is not a flag, and the
// error it produces ("unknown option") points at the user's typing rather than at the keyboard.
// React Native exposes no switch for it (autoCorrect only covers spelling), so the paste line
// normalises on the way out: every substitution iOS makes has an ASCII original, and this puts it
// back. It touches ONLY those characters — a real em dash inside a commit message survives as
// two hyphens, which is the same thing every shell user types anyway.
const SUBS: Array<[RegExp, string]> = [
  [/—/g, '--'],   // em dash — from two hyphens
  [/–/g, '-'],    // en dash – from one hyphen between digits
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, '...'],
  [/ /g, ' '],    // a non-breaking space is not a word separator to a shell
];

export function asciiForShell(text: string): string {
  let out = text;
  for (const [re, to] of SUBS) out = out.replace(re, to);
  return out;
}
