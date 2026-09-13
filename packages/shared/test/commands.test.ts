import { describe, expect, it } from 'vitest';
import { isLowRiskPermissionCard, parseQuestions } from '../src/cards';
import { HumanCommandSchema, taskCreateCommand } from '../src/commands';
import { claudeDesignPromptBlock, claudeDesignUrlFromText, designProviderFromDecision, designProviderFromEvents, designProviderQuestionBlock } from '../src/design';

describe('HumanCommandSchema', () => {
  it('accepts a task.accept gate', () => {
    const r = HumanCommandSchema.safeParse({ type: 'task.accept', taskId: 't1' });
    expect(r.success).toBe(true);
  });

  it('accepts task.create and applies its defaults', () => {
    const r = HumanCommandSchema.safeParse({ type: 'task.create', workspace: 'ws', channel: 'dev', title: 'ship it' });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'task.create') {
      expect(r.data.backlog).toBe(false); // parks-an-idea flag defaults off
      expect(r.data.description).toBe('');
    }
  });

  it('accepts the design gate humans own (approve_design) + revise with feedback', () => {
    expect(HumanCommandSchema.safeParse({ type: 'task.approve_design', taskId: 't1' }).success).toBe(true);
    expect(HumanCommandSchema.safeParse({ type: 'task.revise_design', taskId: 't1', feedback: 'tighten spacing' }).success).toBe(true);
    expect(HumanCommandSchema.safeParse({ type: 'task.revise_design', taskId: 't1' }).success).toBe(false); // feedback required
  });

  it('leaves the design engine open for Iris to ask, then accepts a human selection', () => {
    const plain = HumanCommandSchema.safeParse({ type: 'task.request_design', taskId: 't1' });
    expect(plain.success && plain.data.type === 'task.request_design' && plain.data.provider).toBeUndefined();
    expect(HumanCommandSchema.safeParse({ type: 'task.request_design', taskId: 't1', provider: 'claude-design' }).success).toBe(true);
    expect(HumanCommandSchema.safeParse({ type: 'task.select_design_provider', taskId: 't1', provider: 'iris' }).success).toBe(true);
    expect(HumanCommandSchema.safeParse({ type: 'task.request_design', taskId: 't1', provider: 'figma' }).success).toBe(false);
  });

  it('recovers the selected provider and allowlisted Claude Design link from audit output', () => {
    expect(designProviderFromEvents([
      { type: 'task.design_requested', payload: {} },
      { type: 'task.design_provider_selected', payload: { provider: 'claude-design' } },
      { type: 'task.design_revising', payload: {} },
    ])).toBe('claude-design');
    expect(designProviderFromEvents([{ type: 'task.design_requested', payload: {} }])).toBeNull();
    expect(claudeDesignUrlFromText('Project: https://claude.ai/design/p/9c0ce167-0db6-4c46-858f-2c8f7f8c61c6.')).toBe('https://claude.ai/design/p/9c0ce167-0db6-4c46-858f-2c8f7f8c61c6');
    expect(claudeDesignUrlFromText('Open https://claude.ai/design while Iris works.')).toBeNull();
    expect(claudeDesignUrlFromText('Approve at https://claude.ai/design/settings, then retry.')).toBeNull();
    expect(claudeDesignUrlFromText('https://evil.example/design/project/abc')).toBeNull();
  });

  // #1034 shipped a "Project not found" link because the round never created a project —
  // the prompt only *asked* for one and the model read someone else's instead. The block
  // now names the project after the task and forbids reusing an existing one.
  it('the Claude Design block mandates a task-named project, not a borrowed one', () => {
    const block = claudeDesignPromptBlock(1034, 'flowe logo revamp');
    expect(block).toContain('create_project');
    expect(block).toContain('"#1034 flowe logo revamp"');
    expect(block).toContain('write_files');
    expect(block).toMatch(/Do NOT reuse/);
    // the exported snapshot stays the visual contract, project or no project
    expect(block).toContain('.nm-evidence/design/');
    expect(block).toMatch(/snapshot-only round is fine/);
    // untitled fallback still renders a usable instruction
    expect(claudeDesignPromptBlock()).toContain('create_project');
  });

  it('rejects a project id truncated by a log slice (#1034)', () => {
    // verbatim from agent-logs row 2982: the tool-result summary was sliced to 160
    // chars mid-uuid, and the truncated copy won because summary was scanned first.
    const sliced = '→ [{"type":"text","text":"[{\\"id\\":\\"9c0ce167-0db6-4c46-858f-2c8f7f8c61c6\\",\\"name\\":\\"neuramesh\\",\\"url\\":\\"https://claude.ai/design/p/9c0ce167-0db6-4c46-858f-2c';
    expect(claudeDesignUrlFromText(sliced)).toBeNull();
    expect(claudeDesignUrlFromText('https://claude.ai/design/p/9c0ce167-0db6-4c46-858f-2c')).toBeNull();
    expect(claudeDesignUrlFromText('https://claude.ai/design/p/not-a-uuid-at-all')).toBeNull();
    // the intact id inside the same blob still resolves
    expect(claudeDesignUrlFromText(`${sliced}8f7f8c61c6\\"}]`)).toBe('https://claude.ai/design/p/9c0ce167-0db6-4c46-858f-2c8f7f8c61c6');
  });

  it('builds a synced, notifying design-provider decision card', () => {
    const block = designProviderQuestionBlock();
    const [question] = parseQuestions(block);
    expect(question).toMatchObject({
      question: 'Where should Iris draft this?',
      kind: 'design-provider',
      allowOther: false,
    });
    expect(question!.options).toHaveLength(2);
    expect(designProviderFromDecision('Use Claude Design', question!.options!)).toBe('claude-design');
    expect(designProviderFromDecision('Draft here with Iris', question!.options!)).toBe('iris');
    expect(isLowRiskPermissionCard(block)).toBe(false);
  });

  it('rejects an agent/daemon-only command (never sent from a phone)', () => {
    // task.submit / task.claim are server-side; they are not in the human union
    expect(HumanCommandSchema.safeParse({ type: 'task.submit', taskId: 't1', artifacts: [] }).success).toBe(false);
    expect(HumanCommandSchema.safeParse({ type: 'agent.register', workspace: 'ws' }).success).toBe(false);
  });

  it('exposes each member schema for direct client use', () => {
    expect(taskCreateCommand.safeParse({ type: 'task.create', workspace: 'ws', channel: 'dev', title: 't' }).success).toBe(true);
  });
});
