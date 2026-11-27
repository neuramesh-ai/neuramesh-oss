import { describe, expect, it } from 'vitest';
import { decideThreadPermission, defaultBaselineRules, isNeuraMeshTool, isReleaseAction, PERMISSION_MODES, type PermissionActionKind, type PolicyAction, type PolicyRule } from '../src/index';

const base = defaultBaselineRules();
const nm = (tool: string) => decideThreadPermission('default', 'mcp', [{ capability: 'tool.mcp', tool }], base);

describe('NeuraMesh tools are safe (George, 2026-11-18)', () => {
  it('spawn, an existing tool and a tool that no list names yet skip the prompt in every mode', () => {
    for (const mode of PERMISSION_MODES) {
      for (const tool of ['spawn', 'create_task', 'message_board_send', 'a_tool_added_tomorrow']) {
        expect(decideThreadPermission(mode, 'mcp', [{ capability: 'tool.mcp', tool }], base)).toEqual({ verdict: 'allow', reason: 'NeuraMesh tool' });
      }
    }
  });

  it('a qualified tool from another server keeps its rules', () => {
    expect(isNeuraMeshTool('mcp__connector__list_files')).toBe(false);
    expect(isNeuraMeshTool('connector__lookup')).toBe(false);
    expect(isNeuraMeshTool('')).toBe(false);
    expect(isNeuraMeshTool(undefined)).toBe(false);
    expect(nm('mcp__connector__list_files').verdict).toBe('ask');
    expect(decideThreadPermission('auto-review', 'mcp', [{ capability: 'tool.mcp', tool: 'mcp__connector__list_files' }], base).verdict).toBe('review');
  });

  it('a person who sets a tool to ask or deny wins over safe', () => {
    const rule = (verdict: 'ask' | 'deny'): PolicyRule => ({ id: 'person', scope: 'workspace', capability: 'tool.mcp', selector: { kind: 'tool', name: 'spawn' }, verdict });
    expect(decideThreadPermission('turbo', 'mcp', [{ capability: 'tool.mcp', tool: 'spawn' }], [...base, rule('ask')]).verdict).toBe('ask');
    expect(decideThreadPermission('turbo', 'mcp', [{ capability: 'tool.mcp', tool: 'spawn' }], [...base, rule('deny')]).verdict).toBe('deny');
    // the same person's rule for every tool, written over the baseline row
    const all: PolicyRule = { id: 'person-all', scope: 'workspace', capability: 'tool.mcp', selector: { kind: 'any' }, verdict: 'ask' };
    expect(decideThreadPermission('default', 'mcp', [{ capability: 'tool.mcp', tool: 'spawn' }], [...base, all]).verdict).toBe('ask');
  });

  it('a mixed call is safe only when each action is a NeuraMesh tool', () => {
    expect(decideThreadPermission('default', 'command', [{ capability: 'tool.mcp', tool: 'spawn' }, { capability: 'shell.exec', command: 'make', shellClass: 'build' }], base).verdict).toBe('ask');
  });
});

describe('a release action follows the permission mode (George, 2026-11-18)', () => {
  // The verdict that a command or a connector write gets in each mode.
  const byMode = { 'request-review': 'ask', default: 'ask', 'auto-review': 'review', turbo: 'allow' } as const;
  const releases: Array<[string, PermissionActionKind, PolicyAction]> = [
    ['accept_task', 'mcp', { capability: 'tool.mcp', tool: 'accept_task' }],
    ['web_click', 'mcp', { capability: 'tool.mcp', tool: 'web_click' }],
    ['web_type', 'mcp', { capability: 'tool.mcp', tool: 'web_type' }],
    ['a publish tool', 'mcp', { capability: 'tool.mcp', tool: 'publish_post' }],
    ['a deploy tool', 'mcp', { capability: 'tool.mcp', tool: 'deploy_site' }],
    ['a merge tool', 'mcp', { capability: 'tool.mcp', tool: 'merge_pr' }],
    ['a connector write', 'mcp', { capability: 'tool.mcp', tool: 'connector__publish' }],
    ['a merge command', 'command', { capability: 'shell.exec', command: 'gh pr merge 12', shellClass: 'vcs' }],
    ['a publish command', 'command', { capability: 'shell.exec', command: 'pnpm publish', shellClass: 'build' }],
  ];

  it('each release action gets the verdict of the mode', () => {
    for (const [label, kind, action] of releases) {
      expect(isReleaseAction(action), label).toBe(true);
      for (const mode of PERMISSION_MODES) {
        expect(decideThreadPermission(mode, kind, [action], base).verdict, `${label} in ${mode}`).toBe(byMode[mode]);
      }
    }
  });

  it('a release action never takes the NeuraMesh tool, read or edit shortcut', () => {
    const accept: PolicyAction = { capability: 'tool.mcp', tool: 'accept_task' };
    for (const kind of ['read', 'edit'] as const) {
      expect(decideThreadPermission('default', kind, [accept], base).verdict).toBe('ask');
      expect(decideThreadPermission('auto-review', kind, [accept], base).verdict).toBe('review');
    }
    expect(decideThreadPermission('default', 'mcp', [{ capability: 'tool.mcp', tool: 'spawn' }, accept], base).verdict).toBe('ask');
  });

  it('a person who sets a release action to ask or deny wins over Turbo', () => {
    for (const [label, kind, action] of releases) {
      const selector = action.capability === 'shell.exec' ? { kind: 'shellClass' as const, value: action.shellClass! } : { kind: 'tool' as const, name: action.tool! };
      const rule = (verdict: 'ask' | 'deny'): PolicyRule => ({ id: 'person', scope: 'workspace', capability: action.capability, selector, verdict });
      expect(decideThreadPermission('turbo', kind, [action], [...base, rule('ask')]).verdict, label).toBe('ask');
      expect(decideThreadPermission('turbo', kind, [action], [...base, rule('deny')]).verdict, label).toBe('deny');
    }
  });
});
