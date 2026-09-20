// The nmq question card — the one-click answer path (docs/12).
import { useEffect, useState } from 'react';
import { nm } from '../bridge/nm';
import { openPolicySettings } from '../lib/toast';
import { openClaudeDesignTerminal } from './terminal';
import type { NmQuestion } from './parse';

// One card for ALL questions in a message: a stepper (1/3 … Next … Submit)
// that posts every answer as a single reply. Answered flows compress to
// one ✓ line per question.
export function QuestionFlow({
  questions,
  answers,
  onAnswer,
  designTaskId,
}: {
  questions: NmQuestion[];
  answers?: Map<string, string>;
  onAnswer?: (text: string) => void;
  designTaskId?: string;
}) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [other, setOther] = useState('');
  const [sent, setSent] = useState(false);
  // THE ANGLE CARD (the UGC playbook, 2026-09-19): the platforms ride beside the angles as chips,
  // connected accounts picked from the start, and the tap on an angle carries them in its answer.
  // The film's LENGTH rides the same way (video-rung plan §8): the lengths the workspace's tier
  // films, one picked (eight seconds, the default, else the shortest), each priced by the door.
  const ugc = questions.find((x) => x.ugc)?.ugc;
  const [platforms, setPlatforms] = useState<string[]>(() => (ugc?.platforms ?? []).filter((p) => p.connected).map((p) => p.id));
  const lengths = ugc?.lengths ?? [];
  const [length, setLength] = useState<number | null>(() => (lengths.find((l) => l.seconds === 8) ?? lengths[0])?.seconds ?? null);
  const withPlatforms = (a: string): string => (ugc ? `${a} · platforms: ${platforms.length ? platforms.join(', ') : 'none picked'}${length ? ` · length: ${length} s` : ''}` : a);
  const isDesignProvider = questions.some((x) => x.kind === 'design-provider');
  const [designConnection, setDesignConnection] = useState<{ configured: boolean; claudeAuthed: boolean; detail: string } | null>(null);
  const [designConnecting, setDesignConnecting] = useState(false);

  useEffect(() => {
    if (!isDesignProvider || !nm) return;
    void nm.claudeDesignStatus().then(setDesignConnection).catch(() => setDesignConnection({ configured: false, claudeAuthed: false, detail: 'Could not check Claude Design.' }));
  }, [isDesignProvider]);

  const connectDesign = async () => {
    if (!nm || designConnecting) return;
    setDesignConnecting(true);
    try {
      const launch = await nm.claudeDesignConnect(designTaskId);
      openClaudeDesignTerminal(launch);
      setDesignConnection({ configured: true, claudeAuthed: true, detail: 'Connected.' });
    } finally {
      setDesignConnecting(false);
    }
  };

  // A policy gate that resolved to `ask`/`deny` renders as a permission card. Give it a quiet
  // way out so a wrong default doesn't become a wall: a text link straight to the policy rule
  // that gated this, where the human can loosen it once instead of approving every time.
  const isPermission = questions.some((x) => x.kind === 'permission');
  const policyLink = isPermission ? (
    <div className="qpolicyrow">
      <button type="button" className="qpolicylink" onClick={() => openPolicySettings()}>Change this in workspace policy →</button>
    </div>
  ) : null;

  const answeredAll = questions.every((q) => answers?.has(q.question));
  if (sent || answeredAll) {
    return (
      <div className="qcard sent">
        {questions.map((q) => (
          <div key={q.question} className="qcompact">
            <span className="qtick">✓</span>
            <span className="qcq">{q.question}</span>
            <span className="qca">{answers?.get(q.question) ?? picked[questions.indexOf(q)] ?? ''}</span>
          </div>
        ))}
        {policyLink}
      </div>
    );
  }

  const q = questions[Math.min(idx, questions.length - 1)]!;
  const last = idx >= questions.length - 1;
  const current = picked[idx] ?? '';
  // one-click answers (v0.33): clicking an option IS the answer — it submits (or advances a
  // multi-question card) immediately, matching Mission Control's decision rows. Only a typed
  // free-form answer keeps an explicit Send (Enter or the button), so free text stays deliberate.
  const submit = (answer: string) => {
    const a = answer.trim();
    if (!a) return;
    setOther('');
    const final = { ...picked, [idx]: q.ugc ? withPlatforms(a) : a };
    setPicked(final);
    if (!last) {
      setIdx(idx + 1);
      return;
    }
    if (!onAnswer) return;
    setSent(true);
    onAnswer(questions.map((x, i) => `**${x.question}** → ${final[i] ?? '(skipped)'}`).join('\n'));
  };

  return (
    <div className="qcard">
      <div className="qhead">
        {questions.length > 1 && <span className="qcount">{idx + 1}/{questions.length}</span>}
        {q.title ?? q.question}
      </div>
      {q.summary && <p className="qsum">{q.summary}</p>}
      {q.command && <div className="qcmd">{q.command}</div>}
      {q.kind === 'permission' && (q.risk === 'high' || q.reason) && (
        <div className="qwhy">
          {q.risk === 'high' && <span className="qrisk">high</span>}
          {q.reason && <span>{q.reason}</span>}
        </div>
      )}
      {/* "prepare for", not "posts to" (George, 2026-09-19): a pick here prepares drafts, it schedules nothing */}
      {q.ugc && (
        <div className="qplatforms" role="group" aria-label="Platforms to prepare for">
          <span className="qplatlbl">prepare for</span>
          {q.ugc.platforms.map((p) => {
            const on = platforms.includes(p.id);
            return (
              <button key={p.id} type="button" className={`qplat${on ? ' on' : ''}`} aria-pressed={on} title={p.connected ? `${p.label} is connected` : `${p.label} is not connected yet`}
                onClick={() => setPlatforms((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}>
                {p.label}{p.connected ? '' : ' ·'}
              </button>
            );
          })}
        </div>
      )}
      {/* the film's length: one chip picked, the picked one's price said in the row (the charge
          shown per film, George's rule); the row is absent when the lane offers one length or none */}
      {q.ugc && lengths.length > 1 && (
        <div className="qplatforms qlengths" role="radiogroup" aria-label="Film length">
          <span className="qplatlbl">length</span>
          {lengths.map((l) => (
            <button key={l.seconds} type="button" role="radio" className={`qplat${length === l.seconds ? ' on' : ''}`} aria-checked={length === l.seconds} title={`about ${l.credits} credits a film`} onClick={() => setLength(l.seconds)}>
              {l.seconds} s
            </button>
          ))}
          {length != null && <span className="qlencost">about {lengths.find((l) => l.seconds === length)?.credits ?? '?'} credits</span>}
        </div>
      )}
      {q.kind === 'design-provider' ? (
        <div className="qprovidergrid">
          {(q.options ?? []).map((o) => {
            const claude = o.provider === 'claude-design';
            const checking = claude && designConnection === null;
            const needsConnect = claude && designConnection !== null && !designConnection.configured;
            return (
              <div key={o.label} className={`qprovideropt${current === o.label ? ' on' : ''}`}>
                <span className={`qprovidericon${claude ? ' claude' : ''}`}>{claude ? 'C' : '🦋'}</span>
                <span className="qprovidertext"><b>{o.label}</b>{o.description && <small>{o.description}</small>}</span>
                {needsConnect ? (
                  <button className="btn sm" disabled={designConnecting} onClick={() => void connectDesign()}>{designConnecting ? 'Connecting…' : 'Connect'}</button>
                ) : (
                  <button className="qprovidergo" aria-label={o.label} disabled={checking} onClick={() => submit(o.label)}>{checking ? '…' : '→'}</button>
                )}
              </div>
            );
          })}
        </div>
      ) : (q.options ?? []).map((o) => (
        <button key={o.label} className={`qopt${current === o.label ? ' on' : ''}`} onClick={() => submit(o.label)}>
          <b>{o.label}</b>
          {o.description && <span>{o.description}</span>}
        </button>
      ))}
      {/* the field is the composer's recipe (rail-ink round): one pill, the input inside it, and on
          the last step the composer's round ↑ as its verb */}
      {(q.allowOther !== false || (questions.length > 1 && idx > 0)) && (
        <div className="qfoot">
          {q.allowOther !== false && (
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Type your own answer…"
              onKeyDown={(e) => e.key === 'Enter' && submit(other)}
            />
          )}
          {questions.length > 1 && idx > 0 && (
            <button className="btn" onClick={() => setIdx(idx - 1)}>‹ Back</button>
          )}
          {q.allowOther !== false && (
            <button className={`btn primary${last ? ' qsend' : ''}`} disabled={!other.trim()} onClick={() => submit(other)} aria-label={last ? 'Send' : 'Next'}>
              {last ? '↑' : 'Next ›'}
            </button>
          )}
        </div>
      )}
      {policyLink}
    </div>
  );
}
