// THE QUESTIONS THE BROWSER MUST ANSWER ITSELF.
//
// An unwired lane falls through to a fallback that resolves an empty ARRAY-LIKE — which is an
// object, and therefore TRUTHY. For a read that gets iterated that is harmless. For a read whose
// truthiness gates UI it is not: `machineLimitInfo` left unwired made
// `if (m) setMachineLimit(m)` pass, and hq put a blocking modal in front of every browser user
// telling them their workspace was on another machine.
//
// So these are pinned. The rule they encode: if a method's RESULT decides whether something
// renders, the web must answer it explicitly rather than let the fallback guess.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { localOverrides } from './webnm-local';

const arm = <T>(name: string): T => (localOverrides() as Record<string, T>)[name]!;

describe('the machine-local refusals', () => {
  test('there is no machine limit in a browser — it must be NULL, not empty', async () => {
    // null is falsy; the fallback's empty is not. That difference is the whole bug.
    const fn = arm<() => Promise<unknown>>('machineLimitInfo');
    assert.equal(typeof fn, 'function', 'must be answered, never left to the fallback');
    assert.equal(await fn(), null);
  });

  test('a browser has no worktree, so terminalInfo says so', async () => {
    // `r.available` truthy from the fallback handed the task view a bogus cwd
    const fn = arm<() => Promise<{ available: boolean; cwd: string | null }>>('terminalInfo');
    const r = await fn();
    assert.equal(r.available, false);
    assert.equal(r.cwd, null);
  });

  test('an opened terminal has ALREADY exited, so no surface waits for bytes that cannot come', () => {
    let exited = false;
    const open = arm<(...a: unknown[]) => Record<string, unknown>>('openTerminal');
    const h = open(1, true, 80, 24, () => {}, () => { exited = true; });
    assert.equal(exited, true, 'onExit must fire synchronously — there was never a session');
    // the handle keeps its real shape, so teardown code does not throw on the way out
    for (const k of ['subId', 'input', 'resize', 'close']) assert.ok(k in h, `handle missing ${k}`);
    assert.doesNotThrow(() => (h['close'] as () => void)());
  });

  test('a filesystem read says WHY it is empty — "nowhere to look" is not "nothing here"', async () => {
    const fn = arm<(r: string) => Promise<{ entries: unknown[]; error?: string }>>('fsList');
    const r = await fn('/x');
    assert.deepEqual(r.entries, []);
    assert.match(r.error ?? '', /not available in the browser/);
  });

  test('every machine-local lane is answered here, not left to the fallback', async () => {
    // the point of the module: drop one of these and the truthy empty answers it again.
    // mediaPreview is deliberately ABSENT: it began here as a blanket null, and webnm-content.ts
    // now answers it for real by probing the image, so a second copy here would only shadow it.
    for (const name of ['gitBranches', 'gitCheckout', 'fsRead', 'fsWrite', 'pickFolder', 'saveFileAs',
      'projectDetect', 'logoDetect', 'footprintGet', 'footprintReclaim', 'agentLogs', 'exportLogs',
      'ensureRuntimeCli', 'processKill', 'sandboxGet', 'sandboxSet', 'fileUpload',
      'watchProcesses', 'watchAgentLogs', 'openExternal', 'openHtml',
      'updateCheck', 'updateDownload', 'updateInstall', 'onOpenThread', 'onPlanLimit']) {
      assert.equal(typeof arm(name), 'function', `${name} fell through to the fallback`);
    }
  });
});
