// The markdown renderer every transcript goes through — and the card dispatcher.
//
// One-way by design: Md imports the cards, no card imports Md. If a card ever needs
// markdown, the shared renderer splits out below this rather than the arrow reversing.
import { Children, useMemo } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseQuestionBlock, stripSuggestions } from '@neuramesh/shared';
import { openLink } from '../lib/links';
import { IconSkill } from '../ui/icons';
import { parseNextSteps, type NmNext, parseReplies, type NmReply, parseNeed, type NmNeed } from '@neuramesh/shared';
import { FILE_NAME_RE, HEX_COLOR, isHexColor, NMAUTH_BLOCK, NMPLAYS_BLOCK, NMQ_BLOCK, NMSCHED_BLOCK, type NmAuth, type NmPlays, type NmQuestion, type NmSched, type TaskRefInfo } from '../cards/parse';
import { AuthCard } from '../cards/AuthCard';
import { FailoverCard } from '../cards/FailoverCard';
import { QuestionFlow } from '../cards/QuestionFlow';
import { SchedRecsCard } from '../cards/SchedRecsCard';
import { PlaybookRecsCard } from '../cards/PlaybookRecsCard';
import { NextStepsCard } from '../cards/NextStepsCard';
import { ReplyOpsCard } from '../cards/ReplyOpsCard';
import { DependencyCard } from '../cards/DependencyCard';
import { ScheduleConfirmCard } from '../cards/ScheduleConfirmCard';
import { TaskProposalCard } from '../cards/TaskProposalCard';
import { TaskRefLink } from '../cards/TaskRefLink';
import { VerdictCard } from '../cards/VerdictCard';

export function swatchify(children: React.ReactNode): React.ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== 'string' || !HEX_COLOR.test(child)) return child;
    HEX_COLOR.lastIndex = 0;
    const parts = child.split(HEX_COLOR);
    const hexes = child.match(HEX_COLOR) ?? [];
    return parts.flatMap((p, i) => (i < hexes.length
      ? [p, <i key={`sw${i}`} className="swatch" style={{ background: hexes[i] }} aria-hidden />, hexes[i]]
      : [p]));
  });
}

export function Md({ text, onAnswer, onDismissCard, answers, onOpenPlan, taskRef, onOpenTask, designTaskId, verdictTask, fileRef, onOpenFile }: { text: string; onAnswer?: (text: string) => void; onDismissCard?: (question: string) => void; answers?: Map<string, string>; onOpenPlan?: (planName?: string) => void; taskRef?: (n: number) => TaskRefInfo | null; onOpenTask?: (id: string) => void; designTaskId?: string; verdictTask?: { id: string; state: string; isSubtask?: boolean; repoBacked?: boolean } | null; fileRef?: (name: string) => boolean; onOpenFile?: (name: string) => void }) {
  const questions: NmQuestion[] = [];
  let stripped = text.replace(NMQ_BLOCK, (whole, json: string) => {
    const q = parseQuestionBlock(json);
    if (q) { questions.push(q); return ''; }
    return whole; // unreadable even loosely — leave it visible rather than swallow it
  });
  // ```nmauth blocks → the actionable reconnect/switch card (same transport idea as nmq)
  const auths: NmAuth[] = [];
  stripped = stripped.replace(NMAUTH_BLOCK, (whole, json: string) => {
    try {
      const a = JSON.parse(json) as NmAuth;
      if (a.provider) { auths.push(a); return ''; }
    } catch { /* malformed → leave as code */ }
    return whole;
  });
  // ```nmsched blocks → the armable-cadence card (round 9), same transport idea
  const scheds: NmSched[] = [];
  stripped = stripped.replace(NMSCHED_BLOCK, (whole, json: string) => {
    try {
      const p = JSON.parse(json) as NmSched;
      if (p.channel && Array.isArray(p.recs) && p.recs.length) { scheds.push(p); return ''; }
    } catch { /* malformed → leave as code */ }
    return whole;
  });
  // ```nmplays blocks → the first-playbooks card (marketing-os round). Run › posts the one
  // pre-drafted ask through onAnswer — the same thread-post path the decision cards ride.
  const plays: NmPlays[] = [];
  stripped = stripped.replace(NMPLAYS_BLOCK, (whole, json: string) => {
    try {
      const p = JSON.parse(json) as NmPlays;
      if (p.channel && Array.isArray(p.plays) && p.plays.length) { plays.push(p); return ''; }
    } catch { /* malformed → leave as code */ }
    return whole;
  });
  // ```nmnext blocks → the next-steps card (marketing-os §13): the run's report distilled to
  // armable rows. parseNextSteps validates + clamps; a malformed block stays visible as code.
  const nexts: NmNext[] = [];
  stripped = stripped.replace(/```nmnext\s*\n([\s\S]*?)```/g, (whole) => {
    const n = parseNextSteps(whole);
    if (n) { nexts.push(n); return ''; }
    return whole;
  });
  // ```nmreply blocks → the reply-ops card (reply-radar): conversations worth joining, each with
  // its target post and the drafted reply. parseReplies validates + clamps; malformed stays code.
  const replies: NmReply[] = [];
  stripped = stripped.replace(/```nmreply\s*\n([\s\S]*?)```/g, (whole) => {
    const r = parseReplies(whole);
    if (r) { replies.push(r); return ''; }
    return whole;
  });
  // ```nmneed blocks → the dependency card (triage-preflight): what the run needs before it
  // can be staffed, with the fix on the card. parseNeed refuses a card with nothing to offer.
  const needs: NmNeed[] = [];
  stripped = stripped.replace(/```nmneed\s*\n([\s\S]*?)```/g, (whole) => {
    const n = parseNeed(whole);
    if (n) { needs.push(n); return ''; }
    return whole;
  });
  // ```nms suggestion blocks are transport too — stripped everywhere (history, mobile-parity,
  // the streaming bubble's partial fence); the pills themselves render OUTSIDE Md, only on
  // the freshness-rule target message (the loops own that context, not the markdown).
  stripped = stripSuggestions(stripped);
  // a `/`-attached skill rides as a leading guillemet marker — lift it out and
  // render it as a chip (the orchestrator parses the same marker server-side)
  let skillTag: { name: string; pack?: string } | null = null;
  stripped = stripped.replace(/^\s*‹skill:([\w-]+)(?:@([\w-]+))?›\s*/, (_m, name: string, pack?: string) => {
    skillTag = { name, pack };
    return '';
  });
  // linkifier passes run only OUTSIDE code spans/fences AND existing markdown links — a
  // `[PR #1042](url)` label must never gain a nested link (nested links break the markdown
  // into visible brackets), and a plan name inside a link label must not be double-wrapped.
  const outsideProtected = (s: string, fn: (seg: string) => string) =>
    s.split(/(```[\s\S]*?```|`[^`]*`|\[[^\]\n]*\]\([^)\n]*\))/g).map((seg, i) => (i % 2 === 1 ? seg : fn(seg))).join('');
  // make mentions of the plan files (versioned or bare) open the inline-comment
  // review — each links to its specific version; bare name resolves to latest.
  // Release plans (ship-plan-vN.md, docs/23) get the same treatment as
  // implementation plans: one linkified name, one review surface.
  if (onOpenPlan) stripped = outsideProtected(stripped, (seg) => seg.replace(/(?:implementation-plan|ship-plan)(?:-v\d+)?\.md/g, (m) => `[${m}](nm:plan/${m})`));
  // #1004 → an inline task link (and only when the number resolves to a real
  // task — unknown numbers stay plain text)
  if (taskRef && onOpenTask) {
    stripped = outsideProtected(stripped, (seg) => seg.replace(/#(\d{4})\b/g, (m, d: string) => (taskRef(Number(d)) ? `[#${d}](nm:task/${d})` : m)));
  }
  // FLOWE_RESEARCH_REPORT.md → the attached file, same shape as the task ref above: rewritten
  // ONLY when the name resolves to an artifact on this task, so prose about package.json in a
  // repo never sprouts a dead link. Works retroactively on every message ever written.
  if (fileRef && onOpenFile) {
    stripped = outsideProtected(stripped, (seg) => seg.replace(FILE_NAME_RE, (m) => (fileRef(m) ? `[${m}](nm:file/${encodeURIComponent(m)})` : m)));
  }
  // Memoized on the (now-stable) brand callbacks so react-markdown keeps the same component
  // identity across live-sync re-renders — otherwise a fresh closure each render remounts every
  // inline TaskRefLink, wiping its hover card and replaying its animation.
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => {
      // nm:task/<n> — the inline reference renders as its own component (hover card + click-to-open)
      if (href?.startsWith('nm:task/') && taskRef && onOpenTask) {
        const info = taskRef(Number(href.slice('nm:task/'.length)));
        if (info) return <TaskRefLink info={info} onOpen={onOpenTask} />;
      }
      if (href?.startsWith('nm:file/') && onOpenFile) {
        const name = decodeURIComponent(href.slice('nm:file/'.length));
        return <button type="button" className="fileref" title={`${name} — open`} onClick={() => onOpenFile(name)}>{children}<span className="fx" aria-hidden>↗</span></button>;
      }
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href === 'nm:plan') onOpenPlan?.();
            else if (href?.startsWith('nm:plan/')) onOpenPlan?.(decodeURIComponent(href.slice('nm:plan/'.length)));
            else if (href) openLink(href); // the link choice (lib/links.ts): here, or the OS browser
          }}
        >
          {children}
        </a>
      );
    },
    // brand palettes read at a glance: hex colors get a live swatch — inline code that IS
    // a hex, plus plain-text hexes inside table cells and list items (where the docs put them)
    code: ({ className, children }) => {
      const t = String(children ?? '');
      if (!className && isHexColor(t)) {
        return <code className="hexcode"><i className="swatch" style={{ background: t.trim() }} aria-hidden />{t}</code>;
      }
      return <code className={className}>{children}</code>;
    },
    td: ({ children }) => <td>{swatchify(children)}</td>,
    li: ({ children }) => <li>{swatchify(children)}</li>,
    p: ({ children }) => <p>{swatchify(children)}</p>,
    // fenced code → a labeled block (language chip + copy); plain pre passes through untouched
    pre: ({ children }) => {
      const code = children as { props?: { className?: string; children?: React.ReactNode } };
      const lang = /language-(\w+)/.exec(code?.props?.className ?? '')?.[1];
      if (!lang) return <pre>{children}</pre>;
      const codeText = String(code?.props?.children ?? '');
      return (
        <div className="codeblock">
          <div className="codehead">
            <span>{lang}</span>
            <button title="copy" onClick={() => void navigator.clipboard?.writeText(codeText)}>⧉</button>
          </div>
          <pre>{children}</pre>
        </div>
      );
    },
  }), [taskRef, onOpenTask, onOpenPlan, onOpenFile]);
  return (
    <div className="md">
      {skillTag && <span className="skillchip"><IconSkill s={12} /> skill: {(skillTag as { name: string }).name}{(skillTag as { pack?: string }).pack ? ` · ${(skillTag as { pack: string }).pack}` : ''}</span>}
      <Markdown
        remarkPlugins={[remarkGfm]}
        // react-markdown sanitizes unknown URL protocols to '' — keep our internal nm: deep-links alive
        urlTransform={(url) => (url.startsWith('nm:') ? url : defaultUrlTransform(url))}
        components={components}
      >
        {stripped}
      </Markdown>
      {questions.length === 1 && questions[0]!.failover
        ? <FailoverCard q={questions[0]!} answers={answers} onAnswer={onAnswer} />
        : questions.length === 1 && questions[0]!.schedule
        ? <ScheduleConfirmCard q={questions[0]!} answers={answers} onAnswer={onAnswer} />
        : questions.length === 1 && questions[0]!.verdict
        ? <VerdictCard q={questions[0]!} answers={answers} onAnswer={onAnswer} onDismiss={onDismissCard} task={verdictTask} />
        : questions.length === 1 && questions[0]!.proposal
        ? <TaskProposalCard q={questions[0]!} answers={answers} onAnswer={onAnswer} />
        : questions.length > 0 && <QuestionFlow questions={questions} answers={answers} onAnswer={onAnswer} designTaskId={designTaskId} />}
      {auths.map((a, i) => <AuthCard key={i} auth={a} />)}
      {scheds.map((sc, i) => <SchedRecsCard key={i} sched={sc} />)}
      {plays.map((pl, i) => <PlaybookRecsCard key={i} plays={pl} onRun={onAnswer} />)}
      {nexts.map((nx, i) => <NextStepsCard key={i} data={nx} answers={answers} onAsk={onAnswer} onOpenTask={onOpenTask} />)}
      {replies.map((rp, i) => <ReplyOpsCard key={i} data={rp} onAsk={onAnswer} />)}
      {needs.map((nd, i) => <DependencyCard key={i} data={nd} />)}
    </div>
  );
}
