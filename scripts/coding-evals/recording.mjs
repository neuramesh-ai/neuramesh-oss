import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readJson, allowedCommand, save } from './support.mjs';

/** Inspect actual tool results, not the assistant's claim or the approval click. The latest
 * test invocation must run after the last edit and report nonempty passing Node tests. */
export function agentVerification(messages, cwd, afterIndex = -1) {
  const calls = new Map();
  let lastEdit = -1, latest;
  for (const [index, message] of messages.entries()) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === 'tool_use') {
        calls.set(block.id, block);
        if (['apply_patch', 'editor'].includes(block.name)) lastEdit = index;
      }
      if (block.type !== 'tool_result') continue;
      const call = calls.get(block.tool_use_id);
      if (call?.name !== 'run_commands' || !call.input?.commands?.every(command=>allowedCommand(command,cwd))) continue;
      let outputs = block.content;
      if (typeof outputs === 'string') { try { outputs = JSON.parse(outputs); } catch { outputs = []; } }
      const passed = !block.is_error && Array.isArray(outputs) && outputs.length > 0 && outputs.every(o =>
        o.success === true && !o.error && /(?:#|ℹ) tests [1-9]\d*/.test(o.result) && /(?:#|ℹ) pass [1-9]\d*/.test(o.result) && /(?:#|ℹ) fail 0\b/.test(o.result));
      latest = { index, passed, commands: call.input.commands, outputs };
    }
  }
  return { ...latest, passed: !!latest?.passed && latest.index > Math.max(lastEdit, afterIndex), lastEdit };
}

/** Independently require successful explicit plan receipts after the completed dial disappears. */
export function agentPlanProgress(messages) {
  const calls = new Map();
  let plan = null;
  for (const message of messages) for (const block of Array.isArray(message.content) ? message.content : []) {
    if (message.role === 'assistant' && block.type === 'tool_use') calls.set(block.id, block);
    if (block.type !== 'tool_result' || block.is_error) continue;
    const call = calls.get(block.tool_use_id);
    if (!['propose_work_plan', 'update_plan_progress'].includes(call?.name)) continue;
    let result;
    try { result = typeof block.content === 'string' ? JSON.parse(block.content) : block.content; } catch { continue; }
    const p = result?.planProgress;
    if (result?.recorded !== true || !p?.id || !Array.isArray(p.statuses) || !p.statuses.length || p.statuses.length !== p.plan?.steps?.length || !p.statuses.every(s => ['pending', 'in_progress', 'completed'].includes(s))) continue;
    if (call.name === 'propose_work_plan' || (p.id === plan?.id && JSON.stringify(p.plan) === JSON.stringify(plan.plan))) plan = p;
  }
  return plan ? { done: plan.statuses.filter(s => s === 'completed').length, total: plan.statuses.length } : null;
}

export async function verifyRecording(run, result, dir, label, afterIndex = -1) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const file = join(run.brain ?? dirname(run.cache), 'conversations', hash(run.workspace), hash(run.actor), hash(result.threadId), 'runtime.json');
  let verification;
  for (let i = 0; i < 15; i++) {
    const recording = await readJson(file).catch(() => ({ messages: [] }));
    const response = recording.messages?.findLast(message=>message.role==='assistant'&&message.modelInfo);
    const progress = agentPlanProgress(recording.messages ?? []);
    verification = { ...agentVerification(recording.messages ?? [], result.cwd, afterIndex), progress, model: response?.modelInfo.id, provider: response?.modelInfo.provider };
    const previous = label === 'followup' ? result.implementationVerification : null;
    const fresh = !previous || (verification.index > previous.index && verification.model && verification.model !== previous.model);
    verification.passed = verification.passed && !!fresh && !!progress && progress.done === progress.total;
    if (verification.passed) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await save(join(dir, `${label}-agent-verification.json`), verification);
  return verification;
}
