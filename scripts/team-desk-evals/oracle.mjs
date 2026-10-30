/** Grade persisted work, not a model's claim that it collaborated. */
export function grade(e) {
  const checks = [];
  const check = (name, value) => checks.push({ name, passed: !!value });
  const { homes, messages, runs, artifacts, marker } = e;
  const lead = homes.find(h => h.seat === 'lead');
  const peers = homes.filter(h => h.seat !== 'lead');
  const receipts=(e.toolReceipts??[]).filter(t=>t.threadId===lead?.id&&t.ok);
  check('lead really listed the team and read both specialist histories',receipts.some(t=>t.name==='list_team')&&peers.every(h=>receipts.some(t=>t.name==='read_agent_thread'&&t.input?.threadId===h.id)));
  const ownReplies = h => messages.filter(m => m.thread_id === h.id && m.author_id === h.agentId && m.author_kind === 'agent' && !m.team_source_thread_id);
  check('three distinct owners keep three stable homes', homes.length === 3 && new Set(homes.map(h => h.id)).size === 3 && new Set(homes.map(h => h.agentId)).size === 3);
  check('each custom agent answered its immediate message', homes.every(h => ownReplies(h).some(m => m.body.includes(`${marker}-${h.seat}-READY`))));
  const initial = homes.map(h => runs.find(r => r.thread_id === h.id && r.agent_id === h.agentId));
  check('at least two real agent runs overlapped', initial.some((a,i) => a && initial.some((b,j) => b && i !== j && +new Date(a.started_at) < +new Date(b.ended_at) && +new Date(b.started_at) < +new Date(a.ended_at))));
  const signoffs = [];
  for (const peer of peers) {
    const requests = messages.filter(m => m.thread_id === peer.id && m.team_source_thread_id === lead.id && m.author_id === lead.agentId && m.author_kind === 'agent' && m.team_depth === 1);
    const returns = messages.filter(m => m.thread_id === lead.id && m.team_source_thread_id === peer.id && m.author_id === peer.agentId && m.author_kind === 'agent' && m.team_depth === 2 && m.body.includes(`${marker}-${peer.seat}-SIGNOFF`) && requests.some(q => +new Date(q.created_at) <= +new Date(m.created_at)));
    check(`${peer.seat}: persisted request and returned contribution`, requests.length > 0 && returns.length > 0);
    signoffs.push(...returns);
  }
  const article = artifacts.find(a => a.created_by === lead.agentId && a.inline_content?.includes(marker) && messages.some(m => m.thread_id === lead.id && m.author_id === lead.agentId && m.body.includes(`‹article:${a.id}›`)));
  check('lead delivered an actual article card after both signoffs', article && signoffs.length >= 2 && signoffs.every(m => +new Date(m.created_at) <= +new Date(article.created_at)));
  const body = article?.inline_content ?? '';
  check('combined deliverable preserves both briefs and the pilot constraint', [marker, '37', '4800', '4.5:1', '14', `${marker}-research-SIGNOFF`, `${marker}-design-SIGNOFF`].every(s => body.replaceAll(',', '').includes(s)));
  check('no cross-project message or artifact leakage', messages.every(m => homes.some(h => h.id === m.thread_id)&&!m.body.includes(e.otherProjectMarker)) && artifacts.every(a => a.project_id === e.projectId) && !body.includes(e.otherProjectMarker));
  check('all recorded runs completed without a failed or pending run', runs.length >= 3 && runs.every(r => r.state === 'done' && r.ended_at));
  check('collaboration stayed bounded without acknowledgement loops', messages.filter(m => m.team_source_thread_id).length >= 4 && messages.filter(m => m.team_source_thread_id).length <= 8);
  return { checks, passed: checks.every(c => c.passed), articleId: article?.id };
}
