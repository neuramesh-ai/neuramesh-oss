// THE BASH JAIL — the machine-side twin of the zsh jail in sync/ipc/terminals.ts.
//
// WHY NOT SHARE THE DESKTOP'S. That one writes a .zshrc and hooks `chpwd` through
// add-zsh-hook. The machine image has bash 5.2 and NO zsh (checked, not assumed), and bash
// has no chpwd hook — the equivalent is PROMPT_COMMAND, which fires before each prompt
// rather than on each cd. So this is a different mechanism for the same idea, and pretending
// one file could serve both shells would mean shipping a jail that silently does nothing on
// one of them.
//
// WHAT IT IS AND IS NOT. A working-directory jail: it snaps PWD back when it leaves the
// root, so nobody wanders into the host filesystem by habit. It is NOT isolation — absolute
// paths still read, and the real boundary is the gVisor sandbox and the pod itself. Said
// plainly here because a jail that is mistaken for a sandbox is worse than no jail.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface Jail {
  /** argv for the shell — bash needs --rcfile, which only applies to an interactive shell */
  shell: string;
  args: string[];
  env: Record<string, string>;
  cleanup(): void;
}

/** build a throwaway rcfile that confines the shell to `root` */
export function makeJail(root: string): Jail {
  const dir = mkdtempSync(join(tmpdir(), 'nm-jail-'));
  const rc = join(dir, 'nm-bashrc');
  writeFileSync(
    rc,
    [
      // resolve once: comparing against a symlinked root would let /tmp -> /private/tmp
      // style aliases read as an escape and bounce the user out of their own workspace
      'NMJAIL_REAL="$(cd "$NMJAIL" 2>/dev/null && pwd -P)"',
      'builtin cd "$NMJAIL_REAL" 2>/dev/null',
      '__nm_jail() {',
      '  local cur; cur="$(pwd -P)"',
      '  case "$cur/" in',
      '    "$NMJAIL_REAL"/*|"$NMJAIL_REAL"/) ;;',
      '    *) builtin cd "$NMJAIL_REAL"; printf \'\\033[33mnm: this terminal is confined to the task workspace\\033[0m\\n\' ;;',
      '  esac',
      '}',
      'PROMPT_COMMAND=__nm_jail',
      "PS1='\\[\\033[32m\\]nm\\[\\033[0m\\] \\W \\$ '",
      // the agent CLIs are installed globally; keep them on PATH for a login-less shell
      'export PATH="/usr/local/bin:$PATH"',
    ].join('\n'),
  );
  return {
    shell: '/bin/bash',
    // --rcfile is ignored unless the shell is interactive, and a terminal shell must be
    // interactive anyway or there is no prompt and no job control
    args: ['--rcfile', rc, '-i'],
    env: { NMJAIL: root },
    cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } },
  };
}
