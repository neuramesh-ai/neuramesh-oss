// The composer — one input, every surface. Extracted from App.tsx (track A3).
import { AgentAvatar } from '../components/AgentAvatar';
import { AutoTextarea } from '../ui/AutoTextarea';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconSearch, IconSkill, IconUser } from '../ui/icons';
import { persona, personaRole } from '../lib/persona';
import { tokenizeDraft } from '@neuramesh/shared';
import { type ComposerPerson } from '../thread/parts';
import { type SkillPackRow, type SkillRow } from '../bridge/rows-content';

// agent text color follows AgentAvatar's precedence: role color when known, else persona tone
export const ROLE_COLOR_VAR: Record<string, string> = { orchestrator: '--role-orch', architect: '--role-arch', developer: '--role-dev', reviewer: '--role-rev', designer: '--role-design', curator: '--role-cur' };

export const TONE_COLOR_VAR: Record<string, string> = { accent: '--accent', green: '--green', warm: '--warm', blue: '--blue', violet: '--violet' };

export function agentColorVar(name: string, role?: string | null): string {
  const r = (role ? String(role).toLowerCase() : personaRole(name)) || '';
  return ROLE_COLOR_VAR[r] ?? TONE_COLOR_VAR[persona(name).tone] ?? '--accent';
}

export function ComposerInput({
  value,
  onChange,
  onSend,
  placeholder,
  people,
  skills,
  packs,
  attachedSkill,
  onPickSkill,
  onClearSkill,
  onOpenSkills,
  onPaste,
  focusSignal,
  mentionSignal,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
  people: ComposerPerson[];
  skills: SkillRow[];
  packs: SkillPackRow[];
  attachedSkill: { name: string; pack?: string | null } | null;
  onPickSkill: (s: { name: string; pack?: string | null }) => void;
  onClearSkill: () => void;
  onOpenSkills?: () => void;
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  focusSignal?: number; // bump to focus the textarea (e.g. clicking Reply on a message)
  mentionSignal?: number; // bump to type "@" and open the picker (the composer's @ button)
}) {
  const [mention, setMention] = useState<{ open: boolean; query: string; index: number }>({ open: false, query: '', index: 0 });
  const [slash, setSlash] = useState<{ open: boolean; query: string; index: number }>({ open: false, query: '', index: 0 });
  const growRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const caretToEnd = useRef(false);
  // focus the textarea on demand (Reply click). The nonce changing is the signal; skip the initial 0.
  useEffect(() => {
    if (!focusSignal) return;
    const ta = growRef.current?.querySelector('textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, [focusSignal]);
  // The @ button asks for the picker rather than opening it itself: typing the character IS the
  // trigger everywhere else, so the button types it too and the one matcher below stays the only
  // thing that decides when the picker is open.
  useEffect(() => {
    if (!mentionSignal) return;
    caretToEnd.current = true;
    onChange(`${value}${value && !/\s$/.test(value) ? ' ' : ''}@`);
    setMention({ open: true, query: '', index: 0 });
    setSlash({ open: false, query: '', index: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the nonce is the whole signal
  }, [mentionSignal]);
  // Park the caret after an insert the user didn't type. Deliberately a layout effect on `value`
  // and not rAF: the offscreen preview harness never runs animation frames (docs: preview-pane trap).
  useLayoutEffect(() => {
    if (!caretToEnd.current) return;
    caretToEnd.current = false;
    const ta = growRef.current?.querySelector('textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }, [value]);

  // in-room teammates first — they're the reachable ones (identical set otherwise);
  // humans also match on their display name ("@alonge" finds george-alonge). Cap 8:
  // room agents no longer crowd every member out of the unqualified "@" list.
  const mq = mention.query.toLowerCase();
  const matches = [...people]
    .sort((a, b) => Number(b.here) - Number(a.here))
    .filter((p) => p.name.toLowerCase().startsWith(mq) || !!p.label?.toLowerCase().includes(mq))
    .slice(0, 8);

  // only DISCOVERABLE skills are pickable (active ∧ enabled ∧ pack not disabled) —
  // the same set agents can reach. A pack that hasn't synced is unknown, not
  // disabled (!== false), so its active skills stay pickable rather than vanishing.
  const packOn = new Map(packs.map((p) => [p.id, !!p.enabled]));
  const packNameById = new Map(packs.map((p) => [p.id, p.name]));
  const activeSkillCount = skills.filter((s) => s.status === 'active' && s.enabled).length;
  const slashGroup = (s: SkillRow) => (s.pack_id ? packNameById.get(s.pack_id) ?? 'Skill pack' : 'Other skills');
  const slashSkills = skills
    .filter((s) => s.status === 'active' && s.enabled && (!s.pack_id || packOn.get(s.pack_id) !== false))
    .filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(slash.query.toLowerCase()))
    .sort((a, b) => slashGroup(a).localeCompare(slashGroup(b)) || a.name.localeCompare(b.name))
    .slice(0, 100); // effectively all — the popup scrolls; search narrows

  const onDraft = (v: string) => {
    onChange(v);
    const m = v.match(/(?:^|\s)@([\w-]*)$/);
    const s = v.match(/(?:^|\s)\/([\w-]*)$/);
    if (m) { setMention({ open: true, query: m[1] ?? '', index: 0 }); if (slash.open) setSlash({ open: false, query: '', index: 0 }); }
    else if (s) { setSlash({ open: true, query: s[1] ?? '', index: 0 }); if (mention.open) setMention({ open: false, query: '', index: 0 }); }
    else { if (mention.open) setMention({ open: false, query: '', index: 0 }); if (slash.open) setSlash({ open: false, query: '', index: 0 }); }
  };

  const insertMention = (name: string) => {
    onChange(value.replace(/(^|\s)@[\w-]*$/, `$1@${name} `));
    setMention({ open: false, query: '', index: 0 });
  };

  // pick a skill → drop the `/query` token and hand the chip to the caller; the
  // marker is prepended to the body on send (kept out of the visible input)
  const insertSkill = (s: SkillRow) => {
    onChange(value.replace(/(^|\s)\/[\w-]*$/, '$1').replace(/^\s+/, ''));
    onPickSkill({ name: s.name, pack: s.pack_id ? packNameById.get(s.pack_id) ?? null : null });
    setSlash({ open: false, query: '', index: 0 });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.open && matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMention((m) => ({ ...m, index: (m.index + 1) % matches.length }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMention((m) => ({ ...m, index: (m.index - 1 + matches.length) % matches.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(matches[mention.index]!.name);
        return;
      }
      if (e.key === 'Escape') {
        setMention({ open: false, query: '', index: 0 });
        return;
      }
    }
    if (slash.open && e.key === 'Escape') { setSlash({ open: false, query: '', index: 0 }); return; }
    if (slash.open && slashSkills.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlash((s) => ({ ...s, index: (s.index + 1) % slashSkills.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlash((s) => ({ ...s, index: (s.index - 1 + slashSkills.length) % slashSkills.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertSkill(slashSkills[slash.index]!); return; }
    }
    // backspace at an empty input with a chip attached clears the attachment
    if (e.key === 'Backspace' && !value && attachedSkill) { onClearSkill(); return; }
    // Enter sends; Shift+Enter inserts a newline; never send mid-IME-composition
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); }
  };

  // keep the backdrop scrolled with the textarea (autosize keeps them the same
  // height until maxRows, after which the textarea scrolls internally)
  const syncScroll = () => {
    const ta = growRef.current?.querySelector('textarea');
    if (ta && hlRef.current) hlRef.current.scrollTop = ta.scrollTop;
  };
  useLayoutEffect(syncScroll, [value]);

  const segs = tokenizeDraft(value, people);
  return (
    <>
      {/* the pickers live INSIDE the grow wrapper (2026-09-11): unpositioned, it hands them to the box as
          before; on the ledgered Home tokens.css positions it, so they hang from the input itself */}
      <div className="cgrow" ref={growRef}>
      {mention.open && matches.length > 0 && (
        <div className="mpop">
          {matches.map((p, i) => (
            <div
              key={p.name}
              className={`item${i === mention.index ? ' sel' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(p.name);
              }}
            >
              {p.kind === 'agent' ? (
                <AgentAvatar name={p.name} emoji={p.emoji} size={20} role={p.role ?? undefined} />
              ) : (
                <span className="pav mhum" aria-hidden><IconUser s={15} /></span>
              )}
              <span className="mwho">{p.name}</span>
              {p.kind === 'human' && !!p.label && p.label.toLowerCase() !== p.name && <span className="mrole">{p.label}</span>}
              {p.kind === 'agent' && (p.here ? (
                <span className="mrole" data-role={(p.role ? String(p.role).toLowerCase() : personaRole(p.name)) || undefined}>
                  {(p.role ? String(p.role).toLowerCase() : personaRole(p.name)) ?? 'agent'}
                </span>
              ) : (
                <span className="mrole away">not in channel</span>
              ))}
            </div>
          ))}
        </div>
      )}
      {slash.open && (
        <div className="slashpop">
          <div className="slashsearch">
            <IconSearch s={14} />
            {slash.query ? <span className="slashq">{slash.query}</span> : <span className="slashq ph">Search skills to attach — keep typing to filter…</span>}
            <span className="slashcount">{slashSkills.length} skill{slashSkills.length === 1 ? '' : 's'}</span>
          </div>
          {slashSkills.length > 0 ? (
            slashSkills.map((s, i) => {
              const grp = slashGroup(s);
              const header = i === 0 || slashGroup(slashSkills[i - 1]!) !== grp;
              return (
                <Fragment key={s.id}>
                  {header && <div className="slashgrp">{grp}</div>}
                  <div
                    className={`slashitem${i === slash.index ? ' sel' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); insertSkill(s); }}
                  >
                    <span className="slashicon"><IconSkill s={13} /></span>
                    <span className="slashname">{s.name}</span>
                    <span className="slashdesc">{s.description}</span>
                  </div>
                </Fragment>
              );
            })
          ) : (
            <div className="slashempty">
              {activeSkillCount > 0 ? (
                <>No skill matches “{slash.query}” — keep typing, or clear the <code>/</code>.</>
              ) : onOpenSkills ? (
                <>No skills in this channel yet. <button className="slashlink" onMouseDown={(e) => { e.preventDefault(); setSlash({ open: false, query: '', index: 0 }); onOpenSkills(); }}>Open Skills to add a pack →</button></>
              ) : (
                <>No skills in this channel yet.</>
              )}
            </div>
          )}
        </div>
      )}
        <div className="chl" ref={hlRef} aria-hidden>
          {segs.map((sg, i) => {
            if (sg.kind === 'text') return <Fragment key={i}>{sg.text}</Fragment>;
            const p = sg.kind === 'mention' && sg.who === 'human' ? null : people.find((x) => x.name === sg.name);
            const colorVar = p ? agentColorVar(p.name, p.role) : '';
            if (sg.kind === 'bare') return <span key={i} className="mtok bare" style={{ ['--mc' as string]: `var(${colorVar})` }}>{sg.text}</span>;
            const cls = sg.who === 'human' ? 'mtok human' : sg.here ? 'mtok' : 'mtok away';
            return <span key={i} className={cls} style={sg.who === 'human' || !sg.here ? undefined : { ['--mc' as string]: `var(${colorVar})` }}>{sg.text}</span>;
          })}
          {/* zero-width tail so a trailing newline still renders a line for the backdrop */}
          {'​'}
        </div>
        <AutoTextarea
          value={value}
          onChange={onDraft}
          onKeyDown={onKey}
          onPaste={onPaste}
          onScroll={syncScroll}
          placeholder={placeholder}
        />
      </div>
    </>
  );
}
