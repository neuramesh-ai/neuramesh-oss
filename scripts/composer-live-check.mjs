// Run inside ego-browser nodejs after creating one taskspace and a fresh read-only QA thread.
// Environment: COMPOSER_SPACE_ID, COMPOSER_QA_PHASE (patch | model | reload).
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs/promises');
const task = await taskSpace(Number(process.env.COMPOSER_SPACE_ID));
const page = task.page('p1');
const root = process.env.COMPOSER_EVIDENCE_DIR ?? `${process.cwd()}/docs/design/unified-composer-2026-10/evidence`;
const phase = process.env.COMPOSER_QA_PHASE;
const state = () => page.evaluate(() => ({
  text: document.querySelector('.codingthread')?.innerText ?? '',
  agent: document.querySelector('.codingthread .cagent')?.textContent,
  model: document.querySelector('.codingthread .cmodel')?.textContent,
  authors: Array.from(document.querySelectorAll('.codingthread .msg .head b')).map((n) => n.textContent),
  replies: Array.from(document.querySelectorAll('.codingthread .msg')).map((row) => ({ author: row.querySelector('.head b')?.textContent, text: Array.from(row.querySelectorAll('p')).map((p) => p.textContent).join('\n') })).filter((row) => row.text),
  locked: document.querySelector('.codingthread .cagent')?.disabled,
  gate: !!document.querySelector('[aria-label="Continue in Act mode"]'),
  url: location.href,
}));
const checks = [];
const check = (name, yes) => { assert.ok(yes, name); checks.push(name); };
const idle = () => page.waitForFunction(() => !!document.querySelector('.codingthread .cagent') && !document.querySelector('.codingthread .cagent').disabled, undefined, {timeout:45000});
await idle();
const before = await state();
check('informational reply has no implementation gate', !before.gate);
check('no cloud conflict before handoff', !/local brain branch is safe|sync needs a retry/i.test(before.text));
if (phase === 'patch') {
  check('Rex used the selected High reasoning', before.agent.includes('rex') && before.model.includes('High'));
  check('real repository inspection returned hello', before.text.includes("'hello'"));
  await page.screenshot({path: `${root}/rex-real-turn.png`});
  await page.click('.codingthread .cagent');
  await page.screenshot({path: `${root}/thread-agents.png`});
  await page.click('[aria-label="Model for patch"]');
  await page.click('button[aria-label="Thinking for GPT-5.6 Sol"]');
  await page.click('.cmodlv button >> nth=0');
  await page.waitForFunction(() => document.querySelector('.codingthread .cagent')?.textContent.includes('patch') && !document.querySelector('.codingthread .cagent')?.disabled, undefined, {timeout:45000});
  check('Patch and Low reasoning acknowledged together', (await state()).model.includes('Low'));
} else if (phase === 'model') {
  await page.click('.codingthread .cmodel');
  await page.click('button[aria-label="Thinking for Claude Haiku 4.5"]');
  await page.screenshot({path: `${root}/thread-reasoning.png`});
  await page.click('.cmodlv button >> nth=1');
  await page.waitForFunction(() => document.querySelector('.codingthread .cmodel')?.textContent.includes('Haiku') && !document.querySelector('.codingthread .cagent')?.disabled, undefined, {timeout:45000});
  check('another model accepts Medium reasoning', (await state()).model.includes('Medium'));
} else if (phase === 'reload') {
  await page.reload(); await page.waitForSelector('.codingthread .cagent'); await idle();
  const restored = await state();
  check('reload preserves chosen agent and model', restored.agent === before.agent && restored.model === before.model);
  check('reload preserves historical authors', JSON.stringify(restored.replies) === JSON.stringify(before.replies));
}
const count = (await state()).authors.length;
await page.fill('.codingthread textarea', 'State your current name and role. What marker did I ask you to remember, and what did the greeting function return? Answer briefly from this conversation without using tools.');
await page.click('.codingthread button[aria-label="Send"]');
await page.waitForFunction(() => document.querySelector('.codingthread .cagent')?.disabled === true, undefined, {timeout:10000});
check('agent and model cannot change mid-turn', await page.evaluate(() => document.querySelector('.codingthread .cagent').disabled && document.querySelector('.codingthread .cmodel').disabled));
// Sample the real UI while the response arrives. No simulated responses or fixtures.
const frames = `/tmp/nm-composer-video-${phase}`;
await fs.mkdir(frames, {recursive:true});
const times = [];
for (let i = 0; i < 90; i++) {
  times.push(Date.now());
  await page.screenshot({path: `${frames}/${String(i).padStart(3,'0')}.png`});
  if (!(await state()).locked && (await state()).authors.length > count + 1) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await idle();
const after = await state();
const lastReply = await page.evaluate(() => Array.from(document.querySelectorAll('.codingthread .msg:not(.human)')).at(-1)?.innerText ?? '');
check('new reply is from Patch', /patch/i.test(lastReply) && after.agent.includes('patch'));
check('conversation marker survives the handoff', lastReply.includes('silver-pine-42'));
check('repository finding survives the handoff', lastReply.includes('hello'));
check('earlier Rex reply keeps its author', after.authors.includes('rex') && after.authors.includes('patch'));
check('no sync warning after the reply', !/local brain branch is safe|sync needs a retry/i.test(after.text));
await page.screenshot({path:`${root}/${phase}-real-turn.png`});
await fs.writeFile(`${root}/${phase}-browser-checks.json`, JSON.stringify({phase, checks, url:after.url, agent:after.agent,model:after.model,lastReply,frameTimes:times},null,2));
console.log({phase,checks:checks.length,url:after.url,lastReply});
