import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { readJson } from '../coding-evals/support.mjs';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export async function report(out){
  const r=await readJson(join(out,'result.json'));
  const visual=await readJson(join(out,'visual-review.json')).catch(()=>({status:'pending',findings:[]}));
  await writeFile(join(out,'report.html'),`<!doctype html><meta charset="utf-8"><title>Agent Desk real UI eval</title><style>body{max-width:1100px;margin:40px auto;padding:24px;font:16px/1.6 system-ui;background:#f9f6f0;color:#34271e}img{max-width:100%;border:1px solid #ccc}li{margin:8px 0}pre{white-space:pre-wrap}</style><h1>Agent Desk real UI eval</h1><p>${escape(r.id)} · ${escape(r.status)} · visual review ${escape(visual.status)}</p><p>Actual custom agents, concurrent provider runs, persisted collaboration and a combined article. No mocked replies. Each run uses fresh projects; failures remain in their original directories.</p><ul>${r.checks.map(c=>`<li>${c.passed?'✓':'✗'} ${escape(c.name)}</li>`).join('')}</ul>${r.error?`<pre>${escape(r.error)}</pre>`:''}<ul>${visual.findings.map(f=>`<li>${escape(f)}</li>`).join('')}</ul><p><a href="evidence.json">Persisted evidence</a> · <a href="result.json">Results and UI checks</a> · <a href="run.json">Fixture identities and prompts</a></p>${(r.images??[]).map(name=>`<h2>${escape(name)}</h2><img src="${escape(name)}.png">`).join('')}`);
  return {status:r.status,checks:r.checks.filter(c=>c.passed).length,report:join(out,'report.html')};
}
