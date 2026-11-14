// THE ONLY CODE THAT CALLS THE SANDBOX CLI (README.md, invariants 2, 4, 5, 6).
//
// `sandbox exec` kills its parent process when it exits, and only PID 1 survives that (measured).
// So every `sandbox` invocation is spawned here, directly by the daemon, which must be PID 1: never
// through a shell, never through a helper child. The CLI also logs each full command line to Cloud
// Logging, so no secret may reach argv: keys travel as 0400 files that the box reads and deletes.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export * from './box-spec';
import { SANDBOX_BIN, BOX_DEATH, NotPid1Error, assertNoSecrets, loginMounts, runArgv, deleteArgv, execArgv, killScript, tarArgv, type BoxMount, type LoginMountMode } from './box-spec';

export interface BoxTerminal {
  write(data: string): void;
  kill(): void;
  onData(cb: (data: Buffer) => void): void;
  onExit(cb: (code: number | null) => void): void;
}

export interface BoxResult { code: number | null; stdout: string; stderr: string; ms: number }

export type SpawnFn = (cmd: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;

export interface BoxManagerOptions {
  workDir: string;
  secretsDir: string;
  name?: string;
  bin?: string;
  spawn?: SpawnFn;
  /** the process id the PID-1 rule checks (tests inject it) */
  pid?: number;
  log?: (line: string) => void;
  /** the in-memory home whose vendor logins the box gets (`loginMounts`). Unset: `NM_HOME`; null: none */
  homeDir?: string | null;
  /** how the logins cross (`LoginMountMode`). Unset: `NM_BOX_LOGINS`, else `dirs` */
  loginMode?: LoginMountMode;
  /** bind the logins read-only. Off by default: the CLIs refresh their OAuth tokens in place */
  loginReadonly?: boolean;
}

export interface ExecOptions {
  env?: Record<string, string>;
  /** keys (BYOK, tokens): staged as 0400 files, never argv */
  secretEnv?: Record<string, string>;
  stdin?: 'ignore' | 'pipe';
  /** argv words to stage as files rather than log (the prompt, a config, a path): the predicate sees
   *  each word after the command name and its index in `cmd` */
  hideArg?: (word: string, index: number) => boolean;
  /** a box dir to run in */
  cwd?: string;
  /** box dirs to create before the command starts */
  mkdirs?: readonly string[];
  /** a box file the prelude writes the command's pid to (`signal`) */
  pidFile?: string;
}

function loginModeOf(v: string | undefined): LoginMountMode {
  if (v === undefined || v === '') return 'dirs';
  if (v === 'dirs' || v === 'files' || v === 'off') return v;
  throw new Error(`NM_BOX_LOGINS=${v} must be dirs, files or off`);
}

export class BoxManager {
  readonly name: string;
  private readonly bin: string;
  private readonly spawnImpl: SpawnFn;
  private readonly log: (line: string) => void;
  private deathListeners: Array<(why: string) => void> = [];
  private died = false;
  private readonly homeDir: string | null;
  private readonly loginMode: LoginMountMode;

  constructor(private readonly opts: BoxManagerOptions) {
    const pid = opts.pid ?? process.pid;
    if (pid !== 1) throw new NotPid1Error(`machined runs as pid ${pid}. On Cloud Run it must be PID 1, because \`sandbox exec\` kills its parent when it exits. Start it through the image entrypoint with NM_SUBSTRATE=cloudrun (\`node --import tsx\`), not under a wrapper.`);
    this.name = opts.name ?? 'box';
    this.bin = opts.bin ?? SANDBOX_BIN;
    this.spawnImpl = opts.spawn ?? nodeSpawn;
    this.log = opts.log ?? ((line) => console.log(`[box] ${line}`));
    this.homeDir = opts.homeDir === undefined ? (process.env['NM_HOME'] || null) : opts.homeDir;
    this.loginMode = opts.loginMode ?? loginModeOf(process.env['NM_BOX_LOGINS']);
  }

  /** true once an exec saw the box die; the overlay is gone */
  get dead(): boolean { return this.died; }

  onDeath(cb: (why: string) => void): void { this.deathListeners.push(cb); }

  /** the host work dir the box sees at /work */
  get workDir(): string { return this.opts.workDir; }

  async run(importTar: string | null = null, env: Record<string, string> = {}): Promise<BoxResult> {
    this.died = false;
    // Every bind source must exist. A missing one (like a missing or unreadable --import-tar) lets
    // `sandbox run --detach` exit 0 while the box dies at once (measured). Nothing made the secrets
    // dir before the first staged key, so on a fresh machine the box died at every boot.
    for (const [dir, mode] of [[this.opts.workDir, 0o755], [this.opts.secretsDir, 0o700]] as const) {
      try { mkdirSync(dir, { recursive: true, mode }); } catch (err) { this.log(`cannot make the bind source ${dir}: ${err instanceof Error ? err.message : String(err)}`); }
    }
    const spec = { name: this.name, workDir: this.opts.workDir, secretsDir: this.opts.secretsDir, env, importTar };
    let mounts: BoxMount[] = [];
    try {
      mounts = this.homeDir ? loginMounts(this.homeDir, this.loginMode, { readonly: this.opts.loginReadonly, prepare: true }) : [];
    } catch (err) {
      this.log(`login mounts skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    const first = await this.start(runArgv({ ...spec, mounts }));
    if (first.code === 0 || !mounts.length) return first;
    // the login binds are not proven on every image; a box without logins beats no box at all
    this.log(`run with ${mounts.length} login mounts failed; starting the box without them`);
    return this.start(runArgv(spec));
  }

  /** `sandbox run --detach` exits 0 even when the box dies at once, so a start counts only when the
   *  box then answers an exec. A failed start is deleted with --force, which frees the name and its
   *  netns: without that the next run fails with "device or resource busy" (measured). A box left
   *  by an earlier process in this container is deleted the same way, once. */
  private async start(argv: string[]): Promise<BoxResult> {
    let run = await this.wait(this.call(argv), 'run');
    if (run.code !== 0 && /already exists/.test(run.stderr)) {
      await this.wait(this.call(deleteArgv(this.name)), 'delete');
      run = await this.wait(this.call(argv), 'run');
    }
    if (run.code === 0) {
      const probe = await this.wait(this.call(execArgv(this.name, ['/bin/true'])), 'exec');
      if (probe.code === 0) return run;
      run = { code: probe.code ?? 1, stdout: run.stdout, stderr: `the box died at start (a bind source or the import tar is missing or unreadable): ${probe.stderr.slice(-300)}`, ms: run.ms + probe.ms };
      this.log(run.stderr);
    }
    await this.wait(this.call(deleteArgv(this.name)), 'delete');
    return run;
  }

  /** a streaming exec; the caller owns stdout/stderr. Staged secret files go when the child ends. */
  exec(cmd: readonly string[], o: ExecOptions = {}): ChildProcess {
    const hidden: Record<string, string> = {};
    const hiddenIndex: number[] = [];
    if (o.hideArg) {
      cmd.forEach((w, i) => {
        if (i > 0 && o.hideArg!(w, i)) { hidden[`A${i}`] = w; hiddenIndex.push(i); }
      });
    }
    const staged = this.stage(o.secretEnv ?? {});
    let stagedArgs: Array<{ name: string; file: string }> = [];
    let child: ChildProcess;
    try {
      stagedArgs = this.stage(hidden);
      const args = stagedArgs.map(({ name, file }) => ({ index: Number(name.slice(1)), file }));
      child = this.call(execArgv(this.name, cmd, o.env, staged, { args, cwd: o.cwd, mkdirs: o.mkdirs, pidFile: o.pidFile }), o.stdin ?? 'ignore');
    } catch (err) {
      this.unstage(staged);
      this.unstage(stagedArgs);
      throw err;
    }
    const all = [...staged, ...stagedArgs];
    let tail = '';
    child.stderr?.on('data', (d: Buffer) => {
      tail = (tail + d.toString('utf8')).slice(-4096);
      if (!this.died && BOX_DEATH.test(tail)) {
        this.died = true;
        this.log(`box ${this.name} died under exec`);
        for (const cb of this.deathListeners) cb('exec: containerManager.WaitPID failed: EOF');
      }
    });
    child.once('close', () => this.unstage(all));
    child.once('error', () => this.unstage(all));
    return child;
  }

  /** send a signal to the process an exec recorded in `pidFile` (a short exec of its own) */
  signal(pidFile: string, signal: string): Promise<BoxResult> {
    return this.execWait(killScript(pidFile, signal));
  }

  execWait(cmd: readonly string[], o: ExecOptions = {}): Promise<BoxResult> {
    return this.wait(this.exec(cmd, o), 'exec');
  }

  async alive(): Promise<boolean> {
    if (this.died) return false;
    return (await this.execWait(['/bin/true'])).code === 0;
  }

  /** the box's writable overlay as a plain tar file */
  tar(file: string): Promise<BoxResult> { return this.wait(this.call(tarArgv(this.name, file)), 'tar'); }

  delete(): Promise<BoxResult> { return this.wait(this.call(deleteArgv(this.name)), 'delete'); }

  private call(args: string[], stdin: 'ignore' | 'pipe' = 'ignore'): ChildProcess {
    assertNoSecrets(args);
    // the CLI itself gets no daemon secrets either: the machine token stays in this process
    return this.spawnImpl(this.bin, args, {
      shell: false,
      stdio: [stdin, 'pipe', 'pipe'],
      env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env['HOME'] ?? '/root' },
    });
  }

  private stage(secretEnv: Record<string, string>): Array<{ name: string; file: string }> {
    const names = Object.keys(secretEnv);
    if (!names.length) return [];
    mkdirSync(this.opts.secretsDir, { recursive: true, mode: 0o700 });
    const staged: Array<{ name: string; file: string }> = [];
    try {
      for (const name of names) {
        const file = randomUUID();
        writeFileSync(join(this.opts.secretsDir, file), secretEnv[name]!, { mode: 0o400, flag: 'wx' });
        staged.push({ name, file });
      }
    } catch (err) {
      this.unstage(staged);
      throw err;
    }
    return staged;
  }

  private unstage(staged: ReadonlyArray<{ file: string }>): void {
    for (const { file } of staged) rmSync(join(this.opts.secretsDir, file), { force: true });
  }

  private wait(child: ChildProcess, what: string): Promise<BoxResult> {
    const t0 = Date.now();
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout = (stdout + d.toString('utf8')).slice(-65536); });
      child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-8192); });
      child.once('error', (err) => resolve({ code: null, stdout, stderr: `${stderr}${err.message}`, ms: Date.now() - t0 }));
      child.once('close', (code: number | null) => {
        if (code !== 0) this.log(`${what} exited ${code}: ${stderr.slice(-300)}`);
        resolve({ code, stdout, stderr, ms: Date.now() - t0 });
      });
    });
  }
}
