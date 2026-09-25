// Containment L0: the agent-process env is an ALLOWLIST, not the daemon's inherited env.
// These lock the contract — secrets never reach an agent child; the essentials it needs do.
// Run: pnpm exec tsx --test src/main/runtime/agentenv.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentBaseEnv, codexSandboxMode, onCloudMachine, providerEnv, sandboxEnvForced, sandboxFsEnabled, setAgentProxy, setSandboxFsCache } from './adapter';

test('the FS sandbox is DEFAULT-ON; the NM_SANDBOX_FS env var overrides the UI toggle cache', () => {
  const prev = process.env.NM_SANDBOX_FS;
  try {
    delete process.env.NM_SANDBOX_FS;
    setSandboxFsCache(true);
    assert.equal(sandboxFsEnabled(), true, 'default on (cache true)');
    assert.equal(sandboxEnvForced(), false);
    setSandboxFsCache(false);
    assert.equal(sandboxFsEnabled(), false, 'UI toggle off is honored when env is unset');
    process.env.NM_SANDBOX_FS = 'on';
    assert.equal(sandboxFsEnabled(), true, 'env=on overrides UI-off');
    assert.equal(sandboxEnvForced(), true, 'env pins the value → UI shows it read-only');
    process.env.NM_SANDBOX_FS = 'off';
    setSandboxFsCache(true);
    assert.equal(sandboxFsEnabled(), false, 'env=off overrides UI-on');
  } finally {
    if (prev === undefined) delete process.env.NM_SANDBOX_FS; else process.env.NM_SANDBOX_FS = prev;
    setSandboxFsCache(true); // restore the default-on cache for other tests
  }
});

// A cloud machine is the agents' own box (docs/design/machine-hardening-2026-09, George 2026-09-25):
// no sandbox inside it, and Codex at full access, because its Linux sandbox cannot start on gVisor.
// A laptop keeps exactly what it had.
const withEnv = (vars: Record<string, string | undefined>, fn: () => void): void => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    setSandboxFsCache(true);
  }
};

test('a cloud machine is a runner or a member machine, and a laptop is neither', () => {
  withEnv({ NM_MACHINE_KIND: 'runner' }, () => assert.equal(onCloudMachine(), true));
  withEnv({ NM_MACHINE_KIND: 'member' }, () => assert.equal(onCloudMachine(), true));
  withEnv({ NM_MACHINE_KIND: undefined }, () => assert.equal(onCloudMachine(), false));
  withEnv({ NM_MACHINE_KIND: 'local' }, () => assert.equal(onCloudMachine(), false));
});

test('a cloud machine runs no FS sandbox by default, and the env override still wins', () => {
  withEnv({ NM_MACHINE_KIND: 'runner', NM_SANDBOX_FS: undefined }, () => {
    setSandboxFsCache(true);
    assert.equal(sandboxFsEnabled(), false, 'off inside the box, whatever the cache says');
  });
  withEnv({ NM_MACHINE_KIND: 'member', NM_SANDBOX_FS: 'on' }, () => {
    assert.equal(sandboxFsEnabled(), true, 'NM_SANDBOX_FS=on is still an ops override');
  });
  withEnv({ NM_MACHINE_KIND: undefined, NM_SANDBOX_FS: undefined }, () => {
    setSandboxFsCache(true);
    assert.equal(sandboxFsEnabled(), true, 'a laptop keeps its default-on sandbox');
  });
});

test('Codex runs at full access on a cloud machine and in the requested mode on a laptop', () => {
  withEnv({ NM_MACHINE_KIND: 'runner' }, () => {
    assert.equal(codexSandboxMode('workspace-write'), 'danger-full-access');
    assert.equal(codexSandboxMode('read-only'), 'danger-full-access');
  });
  withEnv({ NM_MACHINE_KIND: undefined }, () => {
    assert.equal(codexSandboxMode('workspace-write'), 'workspace-write');
    assert.equal(codexSandboxMode('read-only'), 'read-only');
  });
});

// a synthetic daemon env: the essentials an agent needs, mixed with secrets it must never see.
const DAEMON = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/dev',
  SHELL: '/bin/zsh',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  TMPDIR: '/tmp/x',
  HTTPS_PROXY: 'http://127.0.0.1:8899', // the L1 egress proxy seam — must pass through
  // secrets the daemon holds that an agent must NOT inherit:
  ANTHROPIC_API_KEY: 'sk-ant-SECRET',
  OPENAI_API_KEY: 'sk-oai-SECRET',
  GEMINI_API_KEY: 'goog-SECRET',
  ANTHROPIC_AUTH_TOKEN: 'oauth-SECRET',
  GITHUB_TOKEN: 'ghp_SECRET',
  GH_TOKEN: 'gho_SECRET',
  DATABASE_URL: 'postgres://SECRET',
  NM_API: 'https://api.neuramesh.app',
  NM_EMBED: 'on',
  POWERSYNC_URL: 'https://SECRET.powersync',
  AWS_SECRET_ACCESS_KEY: 'aws-SECRET',
} as NodeJS.ProcessEnv;

const SECRETS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'DATABASE_URL', 'NM_API', 'NM_EMBED', 'POWERSYNC_URL', 'AWS_SECRET_ACCESS_KEY'];

test('agentBaseEnv keeps the essentials and drops every secret', () => {
  const env = agentBaseEnv(DAEMON);
  // essentials the CLIs + shell tools need
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.equal(env.HOME, '/home/dev');
  assert.equal(env.SHELL, '/bin/zsh');
  assert.equal(env.LANG, 'en_US.UTF-8');
  assert.equal(env.LC_ALL, 'en_US.UTF-8'); // LC_* prefix
  assert.equal(env.TMPDIR, '/tmp/x');
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:8899'); // proxy seam preserved
  // every secret is absent by construction
  for (const k of SECRETS) assert.equal(env[k], undefined, `${k} must not reach an agent`);
});

test('providerEnv injects only the one key in apikey mode, nothing in subscription mode', () => {
  // apikey mode: exactly the invoked provider's key, into the var the tool reads
  const anth = providerEnv('anthropic', 'sk-ant-USER', DAEMON);
  assert.equal(anth.ANTHROPIC_API_KEY, 'sk-ant-USER');
  assert.equal(anth.OPENAI_API_KEY, undefined); // no cross-provider key
  assert.equal(anth.GEMINI_API_KEY, undefined);

  const oai = providerEnv('openai', 'sk-oai-USER', DAEMON);
  assert.equal(oai.OPENAI_API_KEY, 'sk-oai-USER');
  assert.equal(oai.ANTHROPIC_API_KEY, undefined);

  // subscription mode (no token): NO provider key at all — the CLI uses its own stored login
  const sub = providerEnv('anthropic', '', DAEMON);
  assert.equal(sub.ANTHROPIC_API_KEY, undefined);
  assert.equal(sub.ANTHROPIC_AUTH_TOKEN, undefined); // the inherited daemon secret never leaks through
  assert.equal(sub.PATH, '/usr/bin:/bin'); // but the essentials still there so it can run
});

test('NM_AGENT_ENV_PASSTHROUGH extends the allowlist for an unusual toolchain', () => {
  const src = { ...DAEMON, FOO_TOOL_HOME: '/opt/foo', BAR: 'baz', NM_AGENT_ENV_PASSTHROUGH: 'FOO_TOOL_HOME, BAR' } as NodeJS.ProcessEnv;
  const env = agentBaseEnv(src);
  assert.equal(env.FOO_TOOL_HOME, '/opt/foo');
  assert.equal(env.BAR, 'baz');
  // the escape hatch does not weaken secret exclusion
  assert.equal(env.DATABASE_URL, undefined);
});

test('setAgentProxy routes agent egress through the L1 proxy, deferring to a user proxy', () => {
  const clean = { PATH: '/bin', HOME: '/h' } as NodeJS.ProcessEnv;
  try {
    assert.equal(agentBaseEnv(clean).HTTPS_PROXY, undefined); // off by default

    setAgentProxy('http://127.0.0.1:62000');
    const routed = agentBaseEnv(clean);
    assert.equal(routed.HTTP_PROXY, 'http://127.0.0.1:62000');
    assert.equal(routed.HTTPS_PROXY, 'http://127.0.0.1:62000');

    // a user's own corp/VPN proxy is never overridden
    const userProxied = agentBaseEnv({ ...clean, HTTPS_PROXY: 'http://corp.proxy:8080' } as NodeJS.ProcessEnv);
    assert.equal(userProxied.HTTPS_PROXY, 'http://corp.proxy:8080');
  } finally {
    setAgentProxy(null); // reset module state so it can't leak into other tests
  }
  assert.equal(agentBaseEnv(clean).HTTPS_PROXY, undefined);
});
