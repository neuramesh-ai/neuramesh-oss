// Google runtime adapter. Google deprecated the consumer `gemini` CLI (2026-06-18), so the agentic
// coding loop (runQuery) and subscription-mode reason/chat now drive Antigravity's `agy` CLI
// headless — Google-account OAuth, NO API key (`agy --print`, plain-text stdout). When the user
// instead supplies a GEMINI_API_KEY, non-agentic turns use the raw @google/genai SDK (fast,
// in-process). WORKERS always go through agy (the SDK can't do the file/bash loop); a worker needs
// an agy login — a GEMINI_API_KEY alone only powers the SDK (chat/reason/orchestrator) paths.
import { spawn } from 'node:child_process';
import type { LogFn } from '../agentlog';
import type { TurnOpts, RuntimeAdapter, ProposeSkillFn, RecordLessonFn, AddBacklogItemFn, BeatsFn, AgentAttachment, PromptOverride, PermissionGate } from './adapter';
import { agentBaseEnv, buildCodingPrompt, chatSystemPrompt, isInlineImage, sandboxFsEnabled } from './adapter';
import { instructionsFor } from '../host/turnkit';
import { beatMarkerSink, stripBeatMarkers } from '../beats';
import { openBusBridge, ensureAgyBus, userDataDir, beatsAdapter } from '../harness/turntools';
import { computeFsJail } from '../sandbox/fsjail';
import { buildSeatbeltProfile, cleanupTempProfile, sandboxExecArgv, sandboxExecAvailable, writeTempProfile } from '../sandbox/seatbelt';
import { ensureCli } from './cli';

// Run `agy --print` non-interactively. Auth = the machine's Google login (system keyring;
// ANTIGRAVITY_API_KEY honored if set) — we never inject a GEMINI_API_KEY here (agy owns its auth).
// stdout is the plain-text response.
//
// CRITICAL: the argv must be EXACTLY `--print <prompt>` (cwd = worktree) — NO other flags. agy
// surfaces its own flags into the model's context, which trips its built-in `antigravity_guide`
// skill and derails the run into explaining the flag instead of doing the work. Verified per flag:
// the bare invocation edits the worktree in ~8s, whereas `--dangerously-skip-permissions` makes agy
// lecture about that flag (exit 0, zero edits — a silent no-op), and even `--model <name>` makes it
// announce the model and stop (or hang past a 200s timeout). So we pass NO permission flag (in
// --print mode there's no TTY to confirm on, so agy auto-runs its file/bash tools under its default
// policy), NO `--add-dir` (cwd is already the workspace root), and NO `--model`. The agy/OAuth path
// therefore uses agy's own configured default model — per-agent model selection is honored on the
// @google/genai SDK / API-key path instead (agy's default is set in agy's own settings.json).
// Containment L1b (flag-gated NM_SANDBOX_FS): wrap agy in a macOS Seatbelt sandbox that denies the
// credential stores + NeuraMesh userData at the kernel. agy has no native sandbox and no PreToolUse
// hook, so this is its only FS jail. The sandbox-exec flags precede the binary, so agy's own argv stays
// EXACTLY `--print <prompt>` (its hard constraint). Returns null (run un-jailed) when the flag is off,
// we're not on macOS / sandbox-exec is missing, or setup throws — fail-open by design.
async function agySeatbelt(bin: string, argv: string[], dir: string | undefined, protectedPaths: string[] | undefined, log?: LogFn): Promise<{ cmd: string; args: string[]; cleanup: () => void } | null> {
  if (!sandboxFsEnabled() || !sandboxExecAvailable()) return null;
  try {
    const { app } = await import('electron');
    const jail = computeFsJail({ worktree: dir ?? process.cwd(), userDataDir: app.getPath('userData'), extraPaths: protectedPaths });
    const prof = writeTempProfile(buildSeatbeltProfile(jail.denySubpaths, jail.allowSubpaths));
    const full = sandboxExecArgv(bin, argv, prof);
    return { cmd: full[0]!, args: full.slice(1), cleanup: () => cleanupTempProfile(prof) };
  } catch (e) {
    log?.({ kind: 'exec', phase: 'started', summary: `sandbox unavailable — agy runs un-jailed (${(e as Error).message.slice(0, 80)})`, level: 'warn' });
    return null;
  }
}

async function agyExec(args: { dir?: string; prompt: string; ac?: AbortController; log?: LogFn; onDelta?: (t: string) => void; protectedPaths?: string[]; busEnv?: Record<string, string> }): Promise<string> {
  const bin = await ensureCli('gemini', args.log);
  const argv = ['--print', args.prompt];
  const sbx = await agySeatbelt(bin, argv, args.dir, args.protectedPaths, args.log);
  return new Promise<string>((resolve, reject) => {
    // stdin MUST be closed: spawned headless (not from a shell/TTY), `agy --print` blocks waiting
    // for stdin EOF if stdin is an open pipe — it never starts the turn and hangs to the timeout.
    // 'ignore' gives it immediate EOF (verified: with stdin ignored it replies in ~4s; with a default
    // pipe it hangs >45s). stdout/stderr stay piped so we still capture the response.
    // Containment L0: agy runs under the same allowlisted env as the other runtimes (was {...process.env},
    // the most-exposed path). agy authenticates via its own Google-OAuth login under HOME, so no key is
    // injected — and any stray GEMINI/GOOGLE_API_KEY is dropped, keeping agy on OAuth as intended.
    // busEnv carries NM_ORCH_{URL,TURN,SECRET} — the loopback MCP bridge's per-turn credentials, which
    // agy passes down to the stdio shim it spawns. Layered ON TOP of the L0 allowlist rather than
    // through it: these are per-turn, non-secret-bearing coordinates for a 127.0.0.1 endpoint, not
    // inherited environment, so they must not be added to AGENT_ENV_ALLOW (which would let a stray
    // NM_ORCH_* in the daemon's own env leak into every agent).
    const child = spawn(sbx ? sbx.cmd : bin, sbx ? sbx.args : argv, { cwd: args.dir, env: { ...agentBaseEnv(), ...(args.busEnv ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    if (args.ac) args.ac.signal.addEventListener('abort', () => child.kill('SIGTERM'));
    let out = '';
    let errTail = '';
    child.stdout.on('data', (d) => { out += String(d); args.onDelta?.(out.trim()); });
    child.stderr.on('data', (d) => { errTail = (errTail + String(d)).slice(-400); });
    child.on('error', (e) => { sbx?.cleanup(); reject(new Error(`agy CLI failed to start: ${e.message}`)); });
    child.on('close', (code) => {
      sbx?.cleanup();
      if (args.ac?.signal.aborted) { resolve(out.trim() || '(capped)'); return; }
      if (code === 0) { args.log?.({ kind: 'result', phase: 'success', summary: 'completed · agy' }); resolve(out.trim() || '(no reply)'); return; }
      reject(new Error(`agy exited ${code}: ${errTail.replace(/\s+/g, ' ').slice(-200) || 'is agy signed in? run `agy` once to sign in with your Google account'}`));
    });
  });
}

// Gemini is natively multimodal: build `contents` with inlineData image parts when images are
// attached (the @google/genai API-key path), else the plain transcript string. The agy/OAuth CLI is
// text-only (`agy --print`), so on that path images stay in the manifest the transcript already carries.
function geminiContents(transcript: string, attachments?: AgentAttachment[]): string | Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> {
  const imgs = (attachments ?? []).filter(isInlineImage);
  if (!imgs.length) return transcript;
  return [{ text: transcript }, ...imgs.map((a) => ({ inlineData: { mimeType: a.mime, data: a.base64! } }))];
}

export const geminiAdapter: RuntimeAdapter = {
  async streamTurn(agent, channelSlug, transcript, token, log, onDelta, attachments) {
    if (!token) return agyExec({ prompt: `${chatSystemPrompt(agent.name, channelSlug, agent.brief)}\n\n${transcript}`, log, onDelta });
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: token });
    const started = Date.now();
    try {
      const stream = await ai.models.generateContentStream({
        model: agent.model,
        contents: geminiContents(transcript, attachments),
        // instructionsFor, not agent.brief: local › baseline › shipped — a CLI seat honoring only
        // the synced brief silently ignored the machine's own overlay edits (2026-08-18 audit A6)
        config: { systemInstruction: chatSystemPrompt(agent.name, channelSlug, instructionsFor(agent)), maxOutputTokens: 1500 },
      });
      let text = '';
      for await (const chunk of stream) {
        if (chunk.text) { text += chunk.text; onDelta?.(text); }
      }
      log?.({ kind: 'result', phase: 'success', summary: `replied (${Date.now() - started}ms · gemini)` });
      return text.trim() || '(no reply)';
    } catch (err) {
      log?.({ kind: 'result', phase: 'error', summary: `gemini chat turn failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`, level: 'error' });
      throw err;
    }
  },
  async complete(system, user, token, model, maxTokens = 2000) {
    if (!token) return agyExec({ prompt: `${system}\n\n${user}` });
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: token });
    const r = await ai.models.generateContent({
      model,
      contents: user,
      config: { systemInstruction: system, maxOutputTokens: maxTokens },
    });
    return (r.text ?? '').trim();
  },
  async runQuery(agent, t, dir, token, channelBlock, repoBacked, ac, log, skills, proposeSkill?: ProposeSkillFn, reworkNotes?: string, attachmentsNote?: string, recordLesson?: RecordLessonFn, lessonsNote?: string, promptOverride?: PromptOverride, addBacklogItem?: AddBacklogItemFn, beats?: BeatsFn, _permissionGate?: PermissionGate, protectedPaths?: string[], opts?: TurnOpts) {
    void token; // workers authenticate through agy's own Google login, not a GEMINI_API_KEY
    // ── The tool bus (docs/harness/03) ─────────────────────────────────────────────────────────
    // agy used to receive these six tool closures and discard every one of them. Now they arrive as
    // real MCP tools through the loopback bridge, so a Gemini-seated worker declares beats, records
    // lessons and parks discoveries exactly like a Claude one.
    const ud = userDataDir();
    ensureAgyBus(ud); // idempotent MERGE into agy's own mcp_config; inert outside a turn
    const bus = await openBusBridge(
      { kind: opts?.turnKind ?? (promptOverride ? 'design' : 'work'), host: { dir, log, skills, proposeSkill, recordLesson, addBacklogItem, ...(beats ? { beats: beatsAdapter(beats) } : {}), ...(opts?.spawn ? { spawn: opts.spawn } : {}), ...(opts?.park ? { park: opts.park } : {}), ...(opts?.whiteboards ? { whiteboards: opts.whiteboards } : {}), ...(opts?.searchX ? { searchX: opts.searchX } : {}), ...(opts?.draftReplies ? { draftReplies: opts.draftReplies } : {}) } },
      ud,
      log,
    );
    // The stdout-marker sink survives ONLY as the fail-open fallback for a turn whose bridge never
    // started — never as the primary path (docs/harness §1.3: a mechanism, not model etiquette).
    const onDelta = beats && !promptOverride && !bus.count ? beatMarkerSink(beats.advance) : undefined;
    try {
      const out = await agyExec({ dir, prompt: promptOverride?.prompt ?? buildCodingPrompt(t, channelBlock, repoBacked, skills, reworkNotes, attachmentsNote, lessonsNote, agent.brief, bus.count > 0), ac, log, onDelta, protectedPaths, busEnv: bus.env });
      return onDelta ? stripBeatMarkers(out) : out;
    } finally {
      bus.cleanup();
    }
  },
};
