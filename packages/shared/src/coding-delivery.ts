import { createEngineeringPlanProgress } from './engineering/plan-progress';
import { normalizeTaskMarkdown } from './task-handoff';

/** Applies to every role, with or without a workspace writing style. */
export const EVIDENCE_INTEGRITY = `Never manufacture evidence. Only report a check, result, quote, screenshot, or observation you actually obtained from its source. A mockup, generated image, reconstructed page, or invented test log cannot verify implementation. If a check fails or cannot run, name the blocker, keep the criterion open, and distinguish any illustrative material from observed results. Never substitute generated pixels for a browser or device capture. When relaying another agent’s result, attribute it and state what you independently verified.`;

/** A receipt is stored outside the worktree, alongside the immutable uploaded image. */
export interface CaptureOrigin { source: 'managed-browser' | 'independent-observer'; target: string; reviewedRevision?: string }
export interface CaptureReceipt extends CaptureOrigin { name: string; sha256: string; capturedAt: string }
export function requireCaptureReceipts(images: ReadonlyArray<{name:string;sha256:string}>, receipts: readonly CaptureReceipt[], startedAt?: number) {
  const targets = new Map<string, Set<string>>();
  for (const image of images) {
    const [,phase,file] = image.name.split('/');
    const view = file!.replace(/\.(?:png|jpe?g)$/i,'');
    const matching = receipts.filter(r => r.name === image.name && r.sha256 === image.sha256 &&
      (phase !== 'after' || startedAt === undefined || Date.parse(r.capturedAt) >= startedAt));
    if (!matching.length) throw new Error(`Unverified screenshot ${image.name}. Capture the real application or report the blocker.`);
    const previous = targets.get(view);
    const current = new Set(matching.map(r=>r.target).filter(target=>!previous || previous.has(target)));
    if (!current.size) throw new Error(`The before and after captures for ${view} used different targets. Use the same route, viewport and theme.`);
    targets.set(view,current);
  }
}

/** The same contract is discoverable in the skill library and injected into delegated coding turns. */
export const CODING_DELIVERY_SKILL = `Use this skill when implementing and reviewing a coding task.
${EVIDENCE_INTEGRITY}
1. Read the approved plan and acceptance criteria. Start the recorded work plan before editing. Mark each step complete only after its check passes.
2. For a change someone can see or interact with, capture the original behavior from the actual app before editing. Use capture_task_view for repository web pages or their actual static build. For a server-rendered site use the actual deployed preview origin and route with capture_task_view. A general coding command runs in a network-isolated shell. Use the managed browser for Chromium. Independent browser or device captures supplied by an authorized verifier can also be checked against their original bytes. If no trusted capture is available, report visual verification as blocked. Use the same route, viewport, theme and representative state for the after capture. For a new route, capture the original missing route or the original navigation flow. For a local build, capture_task_view can click a control and assert the resulting visible state. For other apps use the project’s UI harness. Record the interaction you actually tested.
3. Deliver real captures in .nm-artifacts/validation/before/ and .nm-artifacts/validation/after/. Give matching views the same descriptive filename. capture_task_view publishes its own browser capture. Inspect the returned artifact and link it. show_artifact only publishes files and cannot certify their origin. A written description, design mockup, placeholder image, or local path alone does not validate the running app.
4. Run the requested tests. Inspect the final diff against each acceptance criterion, check error paths, and record actual commands, results and limitations. Fix failures and repeat the failed checks. When a check cannot run, report the blocker and leave that criterion open.
5. End the task with a concise account of what changed, the verification results, and clickable links to the saved files. Keep before/after comparisons together. The host carries verified captures into the pull request.
6. Keep responsibility for review. If shipping is requested, prepare a release checklist with CI, rollout, rollback and a live verification step. Wait for the human to approve the release plan before executing any shipping activity.`;

export function codingTaskChecklist(task: { id: string; title: string }, rawPlan: string | null, rawRequirements: string | null) {
  let plan: { approach?: string; version?: number; subtasks?: unknown[] } = {};
  let requirements: unknown = [];
  try { plan = JSON.parse(rawPlan ?? '{}') ?? {}; } catch { /* Old tasks can have no board plan. */ }
  try { requirements = JSON.parse(rawRequirements ?? '[]'); } catch { /* Use the plan itself. */ }
  const approach = typeof plan.approach === 'string' ? normalizeTaskMarkdown(plan.approach) : '';
  const section = /^#{1,6}\s+Implementation steps\s*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im.exec(approach)?.[1] ?? approach;
  const items = section.split('\n').filter(line => /^\s*(?:\d+[.)]|[-*])\s+/.test(line)).map(line => line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim());
  const fallback = Array.isArray(requirements) ? requirements.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [];
  const steps = items.length ? items : fallback.length ? fallback : [approach.trim() || task.title];
  return createEngineeringPlanProgress({
    summary: task.title.slice(0, 400),
    steps: steps.slice(0, 30).map(text => ({
      action: /^(?:test|verify|validate|run|capture|review|check)\b/i.test(text) ? 'command' : 'edit',
      target: text.match(/`([^`\n]+)`/)?.[1]?.slice(0, 2000) || task.title.slice(0, 2000),
      description: text.slice(0, 2000),
    })),
  }, `task:${task.id}:v${Number(plan.version) || 1}`);
}

/** Older handoff tools have no structured choice. Use only affirmative validation criteria. */
export function codingDeliveryPolicy(input: { visualEvidence?: boolean; prepareRelease?: boolean }, criteria: string[]) {
  const asksForScreens = criteria.flatMap(c => c.split(/(?<=[.!?])\s+|[\n;]/)).some(line =>
    /\b(?:before.and.after|screenshots?|visual verification|visual validation)\b/i.test(line) &&
    !/\b(?:no|skip|without|not required|not applicable)\b/i.test(line) &&
    (!/\b(?:remov(?:e|ed|ing)|delet(?:e|ed|ing)|untrack(?:ed|ing)?)\b/i.test(line) ||
      /\b(?:capture|take|provide|attach|publish)\b[^.]*\b(?:new |fresh )?screenshots?\b/i.test(line)));
  return { visualEvidence: input.visualEvidence === true || asksForScreens, prepareRelease: input.prepareRelease === true };
}

export function recordedCodingDelivery(raw: string | null | undefined): { visualEvidence: boolean; prepareRelease: boolean } | null {
  if (!raw) return null;
  try { const delivery = JSON.parse(raw)?.codingDelivery; return delivery && typeof delivery.visualEvidence === 'boolean' && typeof delivery.prepareRelease === 'boolean' ? delivery : null; }
  catch { return null; }
}

export interface ValidationArtifact {
  name: string;
  kind: string;
  content?: string | null;
}

const captureName = /^validation\/(before|after)\/([a-z0-9][a-z0-9-]{0,59})\.(png|jpe?g)$/;

export const isValidationImageName = (name:string) => captureName.test(name);

/** Replica rows can contain several revisions. Compare each view's latest submitted images. */
export function hasPairedValidationImages(rows: readonly Pick<ValidationArtifact, 'kind' | 'name'>[]) {
  const names = new Set(rows.filter(row => row.kind === 'screenshot').map(row => row.name));
  const views = [...names].map(name => captureName.exec(name)).filter(match => match !== null);
  return views.length > 0 && views.every(([, phase, view]) =>
    views.some(([, otherPhase, otherView]) => otherPhase !== phase && otherView === view));
}

/** Verify the bounded payload, file type and end-of-image marker before accepting a task. */
export function validationImages(artifacts: readonly ValidationArtifact[]) {
  const views = new Map<string, { before?: string; after?: string }>();
  for (const artifact of artifacts) {
    const path = captureName.exec(artifact.name);
    if (!path || artifact.kind !== 'screenshot') continue;
    const png = path[3] === 'png';
    const prefix = png ? 'data:image/png;base64,' : 'data:image/jpeg;base64,';
    const data = artifact.content;
    const invalid = () => new Error(`Invalid screenshot bytes for ${artifact.name}.`);
    if (!data?.startsWith(prefix) || data.length > 390_000) throw invalid();
    let bytes: string;
    try { bytes = atob(data.slice(prefix.length)); } catch { throw invalid(); }
    if (bytes.length < 32 || bytes.length > 290_000) throw invalid();
    if (png ? !(bytes.startsWith('\x89PNG\r\n\x1a\n') && bytes.slice(12,16) === 'IHDR' && bytes.endsWith('IEND\xaeB\x60\x82'))
            : !(bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9'))) throw invalid();
    const view = views.get(path[2]!) ?? {};
    const phase = path[1] as 'before' | 'after';
    if (view[phase]) throw new Error(`Duplicate ${phase} capture for ${path[2]}.`);
    view[phase] = artifact.name;
    views.set(path[2]!, view);
  }
  if (views.size > 8) throw new Error('Attach at most eight before and after comparisons.');
  for (const [label, pair] of views) {
    if (!pair.before || !pair.after) throw new Error(`Missing ${pair.before ? 'after' : 'before'} screenshot for ${label}.`);
  }
  return [...views.values()].flatMap(pair => [pair.before!, pair.after!]);
}
