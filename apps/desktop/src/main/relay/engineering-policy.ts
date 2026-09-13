import type { AbstractPowerSyncDatabase } from '@powersync/node';
import {
  classifyShellCommand,
  defaultBaselineRules,
  evaluatePolicy,
  mergePolicies,
  type PolicyAction,
  type PolicyRule,
  type PolicyVerdict,
} from '@neuramesh/shared';
import { credStorePath, rowsToRules, type PolicyRowLite } from '../policygate';
import { engineeringPatchPaths } from '../../engineering-patch';

const recordOf = (input: unknown): Record<string, unknown> => input && typeof input === 'object'
  ? input as Record<string, unknown>
  : {};

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  return ['command', 'path', 'file_path', 'url'].flatMap((key) => strings(record[key]));
}

export function engineeringPolicyActions(toolName: string, input: unknown): PolicyAction[] {
  const value = recordOf(input);
  if (toolName === 'read_files') {
    const paths = [...strings(value['files']), ...strings(value['paths']), ...strings(value['path'])];
    return (paths.length ? paths : [undefined]).map((path) => ({ capability: 'fs.read', ...(path ? { path } : {}) }));
  }
  if (toolName === 'search_codebase') {
    const path = strings(value['path'])[0];
    return [{ capability: 'fs.read', ...(path ? { path } : {}) }];
  }
  if (toolName === 'editor') {
    const path = strings(value['path'] ?? value['file_path'])[0];
    return path ? [{ capability: 'fs.write', path }] : [];
  }
  if (toolName === 'apply_patch') {
    const patch = typeof input === 'string' ? input : strings(value['input'])[0] ?? '';
    return engineeringPatchPaths(patch).map((path) => ({ capability: 'fs.write', path }));
  }
  if (toolName === 'run_commands') {
    const commands = [...strings(value['commands']), ...strings(value['command'])];
    return commands.filter(Boolean).flatMap((command) => {
      // These derived actions improve approval copy only. They are not the security boundary:
      // the generic shell is kernel-isolated from credentials, sibling worktrees, and all network.
      const actions: PolicyAction[] = [{ capability: 'shell.exec', command, shellClass: classifyShellCommand(command) }];
      const credential = credStorePath(command);
      if (credential) actions.push({ capability: 'fs.read', path: credential });
      if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\b|\b(?:pip3?|cargo)\s+install\b/i.test(command)) actions.push({ capability: 'pkg.install' });
      if (/\bgit\s+push\b/i.test(command)) {
        const flags = /(?:^|\s)(?:--force(?:-with-lease)?|-f)(?:\s|$)/.test(command) ? ['--force'] : [];
        actions.push({ capability: 'vcs.push', flags });
      }
      for (const match of command.matchAll(/https?:\/\/[^\s'"`|;&)]+/gi)) {
        try { actions.push({ capability: 'net.egress', host: new URL(match[0]).hostname }); } catch { /* malformed URL denies through its shell classification */ }
      }
      return actions;
    });
  }
  if (toolName === 'fetch_web_content') {
    const urls = [...strings(value['urls']), ...strings(value['url'])];
    return urls.flatMap((raw) => {
      try {
        const host = new URL(raw).hostname;
        return host ? [{ capability: 'net.egress' as const, host }] : [];
      } catch {
        return [];
      }
    });
  }
  if (toolName.includes('__')) return [{ capability: 'tool.mcp', tool: toolName }];
  return [];
}

export function engineeringPolicyVerdict(rules: readonly PolicyRule[], toolName: string, input: unknown): PolicyVerdict {
  const actions = engineeringPolicyActions(toolName, input);
  if (!actions.length) return 'deny';
  const verdicts = actions.map((action) => evaluatePolicy(action, rules).verdict);
  if (verdicts.includes('deny')) return 'deny';
  return verdicts.includes('ask') ? 'ask' : 'allow';
}

/** Load workspace rules, locked invariants, and only the selected authoritative project's rules. */
export async function loadEngineeringPolicyRules(
  db: Pick<AbstractPowerSyncDatabase, 'getAll'>,
  workspaceId: string,
  projectId: string | null = null,
): Promise<PolicyRule[]> {
  const rows = await db.getAll<PolicyRowLite>(
    `select id, scope, capability, selector, verdict, rationale, locked from policies
      where workspace_id = ? and (scope = 'workspace' or locked = 1 or (scope = 'project' and project_id = ?))`,
    [workspaceId, projectId],
  );
  return mergePolicies(defaultBaselineRules(), rowsToRules(rows));
}
