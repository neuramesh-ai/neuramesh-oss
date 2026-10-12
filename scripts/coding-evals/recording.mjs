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

export async function verifyRecording(run, result, dir, label, afterIndex = -1) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const file = join(run.brain ?? dirname(run.cache), 'conversations', hash(run.workspace), hash(run.actor), hash(result.threadId), 'runtime.json');
  let verification;
  for (let i = 0; i < 15; i++) {
    const recording = await readJson(file).catch(() => ({ messages: [] }));
    const response = recording.messages?.findLast(message=>message.role==='assistant'&&message.modelInfo);
    verification = { ...agentVerification(recording.messages ?? [], result.cwd, afterIndex), model: response?.modelInfo.id, provider: response?.modelInfo.provider };
    const previous = label === 'followup' ? result.implementationVerification : null;
    const fresh = !previous || (verification.index > previous.index && verification.model && verification.model !== previous.model);
    verification.passed = verification.passed && !!fresh;
    if (verification.passed) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await save(join(dir, `${label}-agent-verification.json`), verification);
  return verification;
}
