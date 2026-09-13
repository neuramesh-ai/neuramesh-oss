// WHAT A PERSON MAY PASTE INTO THE ATTACH CARD (the mobile fix round, 2026-09-06).
//
// Its own module, away from the card's React Native imports, so a plain Node test can reach it —
// the same reason session-page.ts sits apart from sessions.ts.
//
// IT MIRRORS THE SERVER, it does not out-guess it. `handler/repo.ts` parses with `parseRepoUrl`,
// which is GITHUB ONLY: the loop pushes and opens pull requests with `gh`, so a repo on another
// host could be stored and never used. A generous button would offer a gitlab url the server
// refuses, which turns a typo into a round trip and an error card. The button stays quiet instead.
export function looksLikeRepoUrl(raw: string): boolean {
  const v = raw.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  if (!v) return false;
  return /^(?:https?:\/\/)?github\.com\/[\w.-]+\/[\w.-]+$/i.test(v) || /^[\w][\w.-]*\/[\w][\w.-]*$/.test(v);
}
