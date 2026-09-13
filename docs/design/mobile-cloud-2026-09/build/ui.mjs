// Components for the mobile-cloud mockup. Every recipe here is copied from the desktop's
// tokens.css (rail-ink round, 2026-09-04) and from apps/mobile's existing screens — the phone
// mirrors the desktop's idioms at phone scale, it does not invent a second design language.
import { themeCss } from './tokens.mjs';

export const FONTS = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Instrument+Serif:ital@1&family=Bricolage+Grotesque:wght@600&display=swap';

// ── icons: the desktop icon sheet (apps/desktop/src/renderer/src/ui/icons.tsx), stroke 2 on currentColor ──
const P = {
  threads: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  code: '<path d="M4 17l6-6-6-6"/><path d="M13 19h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
  board: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  compose: '<path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L13 14.6l-3.8.9.9-3.8z"/>',
  machine: '<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M2 20h20"/><path d="M9 20v-4h6v4"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>',
  cloudMachine: '<rect x="2" y="7" width="13.5" height="9.8" rx="2"/><path d="M5.5 20.5h6.5"/><path d="M8.75 16.8v3.7"/><path d="M17.2 8.4h4.5a2.25 2.25 0 0 0 .3-4.5 3.2 3.2 0 0 0-6.1 1.1 1.9 1.9 0 0 0 1.3 3.4z"/>',
  auto: '<path d="M12 21v-7"/><path d="M12 14c0-3.5-5-3.5-5-7.5"/><path d="M12 14c0-3.5 5-3.5 5-7.5"/><path d="M4.5 9 7 6.5 9.5 9"/><path d="M14.5 9 17 6.5 19.5 9"/>',
  checkCircle: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
  circle: '<circle cx="12" cy="12" r="6.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  chevronR: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 2.5 2.5L7 14"/><path d="M12.5 14H17"/>',
  branch: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v6"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  brain: '<path d="M12 4.5a3 3 0 0 0-3 3.1c-1.8.4-3.1 1.9-3.1 3.8a3.9 3.9 0 0 0 1.5 3.1 3.4 3.4 0 0 0 3.3 4.4c.4 0 .9-.1 1.3-.2.4.1.9.2 1.3.2a3.4 3.4 0 0 0 3.3-4.4 3.9 3.9 0 0 0 1.5-3.1c0-1.9-1.3-3.4-3.1-3.8a3 3 0 0 0-3-3.1z"/><path d="M12 4.5v15"/>',
  project: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9h8"/><path d="M8 13h5"/>',
  close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  post: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h6"/>',
  pr: '<circle cx="6" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v6"/><path d="M18 15V9a3 3 0 0 0-3-3h-3"/><path d="m13 3-3 3 3 3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  agents: '<circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="19" r="2.4"/><circle cx="19" cy="19" r="2.4"/><path d="M12 7.4v3.6M12 11l-5.4 6M12 11l5.4 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  wake: '<path d="M12 3v3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M18.4 5.6l-2.1 2.1"/><path d="M3 12h3"/><path d="M18 12h3"/><circle cx="12" cy="13" r="4"/><path d="M8 21h8"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
export const ic = (name, s = 15, cls = '') => `<svg class="${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
export const kebab = (s = 15) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.6" r="1.7"/></svg>`;

// the Porch mark — geometry verbatim from apps/desktop/src/renderer/src/brand.tsx (small cut ≤24px)
const CUTS = {
  std: { arch: 'M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z', eyes: [[18.4, 21.5, 2.75], [29.6, 21.5, 2.75]], smile: 'M17.6 28.4 C20.3 32.8 27.7 32.8 30.4 28.4', smileW: 2.9 },
  sm: { arch: 'M5.5 22 C5.5 10.5 13.5 3.5 24 3.5 C34.5 3.5 42.5 10.5 42.5 22 L42.5 39 C42.5 42.5 40 44.5 37 44.5 L11 44.5 C8 44.5 5.5 42.5 5.5 39 Z', eyes: [[17.8, 21, 3.5], [30.2, 21, 3.5]], smile: 'M17 28.6 C20.2 33.6 27.8 33.6 31 28.6', smileW: 4 },
};
export const porch = (size = 20, variant = 'solid') => {
  const g = size <= 24 ? CUTS.sm : CUTS.std;
  const tile = variant === 'reversed' ? 'var(--brand-ink)' : 'var(--brand)';
  const face = variant === 'reversed' ? 'var(--brand)' : 'var(--brand-ink)';
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><path d="${g.arch}" fill="${tile}"/>${g.eyes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${face}"/>`).join('')}<path d="${g.smile}" fill="none" stroke="${face}" stroke-width="${g.smileW}" stroke-linecap="round"/></svg>`;
};

// the thinking orb (thinking-orbs in the app) — a still frame: eight dots, one lit
export const orb = (s = 16) => `<span class="orb"><svg width="${s}" height="${s}" viewBox="0 0 16 16" aria-hidden="true">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * Math.PI * 2; const x = 8 + 5.6 * Math.cos(a); const y = 8 + 5.6 * Math.sin(a); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${i === 0 ? 1.6 : 1.15}" fill="currentColor" opacity="${(0.25 + 0.75 * ((8 - i) / 8)).toFixed(2)}"/>`; }).join('')}</svg></span>`;

// the credit ring: r=9 in a 22px box, --green arc on a --panel3 track, warm below a fifth (CreditRing.tsx)
export const credring = (frac, size = 22) => {
  const C = 2 * Math.PI * 9;
  return `<span class="credring${frac < 0.2 ? ' low' : ''}"><svg width="${size}" height="${size}" viewBox="0 0 22 22" aria-hidden="true"><circle class="tr" cx="11" cy="11" r="9"/><circle class="ar" cx="11" cy="11" r="9" stroke-dasharray="${(C * frac).toFixed(2)} ${C.toFixed(2)}"/></svg></span>`;
};

// agent identity: the app uses DiceBear Thumbs; the mockup draws a monogram tile on the role wash (placeholder)
const ROLE = { rex: 'orch', patch: 'dev', iris: 'rev', bosun: 'ship', nova: 'design', quill: 'mkt', sage: 'arch', cass: 'cur' };
export const av = (name, s = 28) => name === 'you' || name === 'G'
  ? `<span class="av h" style="width:${s}px;height:${s}px">G</span>`
  : `<span class="av" style="width:${s}px;height:${s}px;background:color-mix(in srgb,var(--role-${ROLE[name] ?? 'dev'}) var(--role-tone),transparent);color:var(--role-${ROLE[name] ?? 'dev'})">${name.slice(0, 2)}</span>`;

// ── the head: mark · workspace ▾ · the cloud-machine pill · the credit ring · search · you ──
export const head = ({ ws = 'neuramesh', pill = 'online', ring = 0.83, search = true } = {}) => `
<div class="head">
  ${porch(22)}
  <span class="ws">${ws} ${ic('chevron', 14)}</span>
  <span class="hcl">
    <span class="hbtn cmp ${pill}" title="cloud machine">${ic('cloudMachine', 18)}</span>
    ${credring(ring)}
    ${search ? `<span class="hbtn">${ic('search', 17)}</span>` : ''}
    <span class="hav">G</span>
  </span>
</div>`;

// a session's head: the crumb, the title, the toks (docs/35 §3.4 — one header anatomy)
export const shead = ({ crumb, title, toks = [] }) => `
<div class="shead">
  <div class="crumb">${ic('back', 13)}<span>${crumb}</span></div>
  ${title ? `<div class="stitle">${title}</div>` : ''}
  ${toks.length ? `<div class="toks">${toks.join('')}</div>` : ''}
</div>`;
export const tok = (inner, warm = false) => `<span class="tok${warm ? ' warm' : ''}">${inner}</span>`;

export const TABS = [['home', 'Home'], ['code', 'Code'], ['clock', 'Routines'], ['board', 'Tasks']];
export const tabbar = (active) => `
<div class="tabs">${TABS.map(([i, l]) => `<span class="tab${l === active ? ' on' : ''}">${ic(i, 22)}<span>${l}</span></span>`).join('')}</div>
<div class="homebar"></div>`;

export const kick = (label, n, right = '') => `<div class="kick"><span>${label}</span>${n ? `<span class="n">· ${n}</span>` : ''}${right ? `<span class="r">${right}</span>` : ''}</div>`;

export const chip = (cls, label) => `<span class="chip c-${cls}">${label}</span>`;
export const dial = (state, frac, live = false) => `<span class="sdial c-${state}${live ? ' live' : ''}" style="--frac:${frac}%;color:var(--${STATE_HUE[state] ?? 'dim'})"></span>`;
const STATE_HUE = { backlog: 'backlog', todo: 'todo', planning: 'plan', plan_review: 'planrev', designing: 'design', design_review: 'designrev', in_progress: 'prog', in_review: 'review', done: 'done', accepted: 'acc', blocked: 'blocked', closed: 'closed' };
export const DIAL_AT = { backlog: 5, todo: 10, designing: 22, design_review: 32, planning: 40, plan_review: 50, in_progress: 62, in_review: 78, done: 86, accepted: 100, closed: 100, blocked: 50 };
export const STATE_LABEL = { plan_review: 'plan review', design_review: 'design review', in_progress: 'build', in_review: 'review', done: 'accept?', accepted: 'accepted', todo: 'todo', blocked: 'blocked', backlog: 'idea' };

/** ONE row anatomy (docs/35 §3.2): glyph · title + snippet · meta (chip · when/room). A task wears
 *  the dial; a chat, a routine's run and a Code session wear the kind glyph; an open run swaps the
 *  glyph for the orb; a question waiting on you pulses at the TRAILING edge (rail-ink round). */
export const srow = ({ kind = 'chat', state, title, snip, snipMono = false, when, live = false, ask = false, on = false, chipText, chipCls }) => {
  let glyph;
  if (live) glyph = orb(16);
  else if (kind === 'task') glyph = dial(state, DIAL_AT[state] ?? 50);
  else glyph = `<span class="sglyph ${kind}">${ic(kind === 'routine' ? 'clock' : kind === 'code' ? 'code' : 'threads', 11)}</span>`;
  const label = chipText ?? (kind === 'task' ? (STATE_LABEL[state] ?? state) : kind);
  const cls = chipCls ?? (kind === 'task' ? state : kind);
  return `
<div class="srow${on ? ' on' : ''}">
  ${glyph}
  <span class="sbody"><span class="st">${title}</span>${snip ? `<span class="ssnip${snipMono ? ' mono' : ''}">${snip}</span>` : ''}</span>
  <span class="smeta"><span class="smr">${ask ? '<span class="ask"></span>' : ''}${chip(cls, label)}</span><span class="swhen">${when}</span></span>
</div>`;
};

// ── cards ──
export const card = (inner, cls = '') => `<div class="card ${cls}">${inner}</div>`;
export const qcard = ({ kicker = 'question · needs you', q, opts = [], picked = null, field = 'Or type your answer…' }) => card(`
  <div class="qk">${kicker}</div>
  <div class="qh">${q}</div>
  <div class="qopts">${opts.map((o) => typeof o === 'string'
    ? `<span class="qopt${o === picked ? ' on' : ''}">${o}</span>`
    : `<span class="qopt blk${o.t === picked ? ' on' : ''}"><span>${o.t}</span><small>${o.sub}</small></span>`).join('')}</div>
  ${field ? `<div class="qfield"><span>${field}</span><span class="send">${ic('up', 15)}</span></div>` : ''}`, 'qcard');

// the human keeps the hairline bubble; agent prose runs on the ground (docs/33 §3, D5 = B)
export const hb = (text) => `<div class="hb">${text}</div>`;
export const am = ({ who, role, time, prose = '', extra = '' }) => `
<div class="am">${av(who)}<div class="ab2">
  <div class="ah"><span class="an">${who}</span><span class="ar">${role}</span><span class="at">${time}</span></div>
  ${prose ? `<div class="ap">${prose}</div>` : ''}${extra}
</div></div>`;
export const liveLine = (who, verb) => `<div class="live">${orb(16)}<span><b>${who}</b> · ${verb}</span></div>`;
export const unit = ({ n, title, state, note, go }) => `<div class="unit">${dial(state, DIAL_AT[state] ?? 50)}<span><b>#${n}</b> · ${title} ${chip(state, STATE_LABEL[state] ?? state)}</span>${note ? `<span class="dim">· ${note}</span>` : ''}${go ? `<span class="go">${go} ›</span>` : ''}</div>`;
export const att = (name, meta, image = true) => `<div class="att">${image ? '<span class="th"></span>' : ic('file', 18)}<span>${name}<small>${meta}</small></span></div>`;

// ── the composer (docs/33 §8): an elevated card, the textarea, then the chips row; the round brand send ──
export const cchip = (icon, label, { open = false, caret = true, iconOnly = false } = {}) => `<span class="cchip${open ? ' open' : ''}${iconOnly ? ' ico' : ''}">${ic(icon, 13)}${iconOnly ? '' : `<span class="lbl">${label}</span>`}${caret && !iconOnly ? '<span class="car">▾</span>' : ''}</span>`;
export const brainpill = (names = ['rex', 'patch', 'iris'], note = '') => `<span class="brain"><span class="avs">${names.map((n) => `<span style="background:color-mix(in srgb,var(--role-${ROLE[n] ?? 'dev'}) var(--role-tone),var(--card));color:var(--role-${ROLE[n] ?? 'dev'})">${n[0]}</span>`).join('')}</span>${note ? `<small>${note}</small>` : ''}</span>`;
export const composer = ({ placeholder = 'Message…', text = '', chips = [], note = '', reply = null, ink = false }) => `
<div class="comp">
  ${reply ? `<div class="replyto">${ic('threads', 13)}<span>Replying to <b>${reply.who}</b> · ${reply.text}</span><span class="x">${ic('close', 13)}</span></div>` : ''}
  ${note ? `<div class="cnote">${note}</div>` : ''}
  <div class="cbox">
    <div class="ta${ink || text ? ' ink' : ''}">${text || placeholder}</div>
    <div class="crow">${chips.join('')}<span class="grow"></span><span class="send big${text ? '' : ' dim'}">${ic('up', 17)}</span></div>
  </div>
</div>`;

/** the machine chip's popover — the ProjectChip recipe (docs/33 §8): "Run this session on", Auto
 *  first with what it resolves to, then icon · name (a teammate's adds their name), the state as an
 *  icon at the row's right, the row Auto resolves to tagged, one foot line. */
export const mpop = ({ rows, foot, hint = 'Run this session on' }) => `
<div class="pop">
  <div class="phint">${hint}</div>
  ${rows.map((r) => `<div class="pitem${r.on ? ' on' : ''}${r.off ? ' off' : ''}"><span class="pg">${ic(r.icon, 14)}</span><span class="pt"><b>${r.name}</b>${r.sub ? `<small>${r.sub}</small>` : ''}</span>${r.st ? `<span class="pst ${r.st}">${STATE_ICON[r.st]}</span>` : ''}${r.tag ? `<span class="ptag">${r.tag}</span>` : ''}${r.on ? `<span class="pck">✓</span>` : ''}</div>`).join('')}
  <div class="pfoot">${foot}</div>
</div>`;
export const STATE_ICON = { on: '●', waking: '●', sleep: '☾', off: '○' };

export const verb = (icon, label, k = '') => `<div class="verb">${ic(icon, 16)}<span>${label}</span>${k ? `<span class="k">${k}</span>` : ''}</div>`;
export const scope = (label, mag = true) => `<div class="scope"><span>${label}</span>${ic('chevron', 12)}${mag ? `<span class="mag">${ic('search', 15)}</span>` : ''}</div>`;
export const segs = (items, on, sm = false) => `<span class="segs${sm ? ' sm' : ''}">${items.map((i) => `<span${i === on ? ' class="on"' : ''}>${i}</span>`).join('')}</span>`;
export const btn = (label, cls = '') => `<span class="btn ${cls}">${label}</span>`;

// ── the stylesheet: one recipe per idiom, values from tokens.css ──
export const CSS = `
${themeCss()}
.ab{display:flex;font:14px/1.5 'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--fmono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;--fdisp:'Source Serif 4',Georgia,serif;--fital:'Instrument Serif',Georgia,serif;--fbrand:'Bricolage Grotesque','Geist',sans-serif;-webkit-font-smoothing:antialiased}
.col{width:450px;padding:26px 30px 34px;background:var(--win);color:var(--text);display:flex;flex-direction:column;align-items:center;gap:12px}
.collbl{align-self:flex-start;font:600 9.5px/1 var(--fmono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.phone{position:relative;width:390px;height:844px;flex:none;border-radius:44px;overflow:hidden;background:var(--bg);border:1px solid var(--border2);box-shadow:var(--shadow-sheet);display:flex;flex-direction:column}
.safe{height:54px;flex:none}
.homebar{height:24px;flex:none;background:var(--panel)}
.head{display:flex;align-items:center;gap:8px;padding:2px 16px 10px;flex:none}
.head .ws{display:flex;align-items:center;gap:5px;font-weight:600;font-size:15px;color:var(--text);letter-spacing:-.01em}
.head .ws svg{color:var(--muted)}
.hcl{margin-left:auto;display:flex;align-items:center;gap:6px}
.hbtn{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;color:var(--muted)}
.hbtn.online{color:var(--green)}.hbtn.waking{color:var(--warn)}.hbtn.asleep{color:var(--dim)}.hbtn.capped{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.hav{width:26px;height:26px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font:700 11px var(--fmono)}
.shead{padding:0 16px 8px;flex:none}
.crumb{display:flex;align-items:center;gap:6px;font:500 10.5px var(--fmono);letter-spacing:.04em;color:var(--dim)}
.stitle{margin-top:6px;font-size:16px;font-weight:620;letter-spacing:-.01em;line-height:1.3;color:var(--text)}
.toks{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;align-items:center}
.tok{display:inline-flex;align-items:center;gap:4px;font:500 10.5px var(--fmono);color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:2px 8px;white-space:nowrap}
.tok svg{width:12px;height:12px}
.tok.warm{color:var(--link);border-color:color-mix(in srgb,var(--link) 40%,transparent)}
.body{flex:1;min-height:0;overflow:hidden;position:relative}
.body.tight .kick{padding:10px 16px 4px}
.body.tight .leg{padding:3px 16px}
.kick{font:600 9.5px/1 var(--fmono);letter-spacing:.11em;text-transform:uppercase;color:var(--dim);padding:14px 16px 6px;display:flex;align-items:center;gap:6px}
.kick .n{color:var(--muted)}
.kick .r{margin-left:auto;display:flex;align-items:center;gap:4px;letter-spacing:.06em;text-transform:none}
.srow{display:flex;align-items:center;gap:11px;padding:9px 12px;margin:0 6px;border:1px solid transparent;border-radius:11px;min-width:0}
.srow.on{background:var(--card);border-color:var(--card-border);box-shadow:var(--shadow-card)}
.sdial{flex:none;width:18px;height:18px;border-radius:50%;background:conic-gradient(currentColor var(--frac),color-mix(in srgb,var(--dim) 30%,transparent) 0);-webkit-mask:radial-gradient(circle at 50% 50%,transparent 5px,#000 5.6px);mask:radial-gradient(circle at 50% 50%,transparent 5px,#000 5.6px)}
.sglyph{flex:none;width:18px;height:18px;display:grid;place-items:center;border:1.5px solid var(--dim);border-radius:6px;color:var(--dim)}
.sglyph.routine{border-radius:50%}
.sglyph.code{border-radius:5px}
.sglyph.live{border-color:var(--prog);color:var(--prog)}
.sbody{flex:1;min-width:0;display:flex;flex-direction:column;gap:1.5px}
.st{font-size:13px;font-weight:620;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
.ssnip{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssnip.mono{font:500 11px var(--fmono)}
.smeta{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.smr{display:inline-flex;align-items:center;gap:6px}
.swhen{font:500 10.5px var(--fmono);color:var(--dim)}
.chip{display:inline-flex;align-items:center;gap:5px;font:650 9.5px var(--fmono);letter-spacing:.08em;padding:3px 9px;border-radius:999px;text-transform:uppercase;white-space:nowrap}
.c-backlog{background:color-mix(in srgb,var(--backlog) 16%,transparent);color:var(--backlog)}
.c-todo{background:color-mix(in srgb,var(--todo) 16%,transparent);color:var(--todo)}
.c-planning{background:color-mix(in srgb,var(--plan) 16%,transparent);color:var(--plan)}
.c-plan_review{background:color-mix(in srgb,var(--planrev) 16%,transparent);color:var(--planrev)}
.c-designing{background:color-mix(in srgb,var(--design) 16%,transparent);color:var(--design)}
.c-design_review{background:color-mix(in srgb,var(--designrev) 16%,transparent);color:var(--designrev)}
.c-in_progress{background:color-mix(in srgb,var(--prog) 16%,transparent);color:var(--prog)}
.c-in_review{background:color-mix(in srgb,var(--review) 16%,transparent);color:var(--review)}
.c-done{background:color-mix(in srgb,var(--done) 16%,transparent);color:var(--done)}
.c-accepted{background:color-mix(in srgb,var(--acc) 16%,transparent);color:var(--acc)}
.c-blocked{background:color-mix(in srgb,var(--blocked) 16%,transparent);color:var(--blocked)}
.c-closed{background:color-mix(in srgb,var(--closed) 16%,transparent);color:var(--closed)}
.c-chat,.c-routine,.c-code,.c-room{background:var(--panel3);color:var(--muted);border:1px solid var(--border2)}
.c-approval{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.c-act{background:color-mix(in srgb,var(--prog) 16%,transparent);color:var(--prog)}
.c-plan{background:color-mix(in srgb,var(--plan) 16%,transparent);color:var(--plan)}
.c-live{background:color-mix(in srgb,var(--prog) 16%,transparent);color:var(--prog)}
.c-paused{background:var(--panel3);color:var(--dim);border:1px solid var(--border2)}
.c-armed{background:color-mix(in srgb,var(--done) 16%,transparent);color:var(--done)}
.c-fired{background:color-mix(in srgb,var(--done) 16%,transparent);color:var(--done)}
.c-next{background:color-mix(in srgb,var(--prog) 16%,transparent);color:var(--prog)}
.c-scheduled{background:color-mix(in srgb,var(--prog) 16%,transparent);color:var(--prog)}
.c-draft{background:color-mix(in srgb,var(--muted) 14%,transparent);color:var(--muted)}
.orb{display:inline-grid;place-items:center;width:18px;height:18px;flex:none;color:var(--text)}
.ask{flex:none;width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.card{background:var(--card);border:1px solid var(--card-border);border-radius:12px;box-shadow:var(--shadow-card);padding:11px 13px 12px;margin:0 12px 8px}
.card .qk,.qk{font:650 9.5px var(--fmono);letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin-bottom:6px}
.qh{font-size:13px;font-weight:600;line-height:1.45;color:var(--text);margin-bottom:8px}
.qopts{display:flex;flex-wrap:wrap;gap:6px}
.qopt{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border2);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:550;color:var(--body);min-height:32px}
.qopt.blk{flex-direction:column;align-items:flex-start;gap:1px;width:100%;border-radius:14px;padding:8px 12px}
.qopt.blk small{color:var(--dim);font-size:11px;font-weight:500}
.qopt.on{border-color:var(--ring);background:var(--sel-bg);color:var(--text)}
.qfield{display:flex;align-items:center;gap:8px;margin-top:8px;border:1px solid var(--border);border-radius:999px;padding:4px 4px 4px 12px;background:var(--panel);color:var(--dim);font-size:12.5px}
.qfield .send{margin-left:auto}
.send{width:30px;height:30px;border-radius:50%;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;flex:none}
.send.big{width:38px;height:38px}
.send.dim{background:var(--panel3);color:var(--dim)}
.btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:999px;padding:9px 16px;font-size:13px;font-weight:600;min-height:38px;border:1px solid var(--border2);color:var(--text);background:transparent;white-space:nowrap}
.btn.primary{background:var(--brand);color:var(--brand-ink);border-color:transparent}
.btn.sm{padding:6px 12px;min-height:32px;font-size:12px}
.btn.ghost{color:var(--body)}
.btnrow{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.msgs{padding:2px 0 8px}
.hb{margin:8px 16px 8px 64px;padding:9px 12px;border:1px solid var(--border);border-radius:14px 14px 4px 14px;background:var(--panel);font-size:13.5px;line-height:1.5;color:var(--text)}
.am{display:flex;gap:9px;padding:7px 16px}
.am .ab2{flex:1;min-width:0}
.ah{display:flex;align-items:baseline;gap:6px}
.an{font-size:12px;font-weight:600;color:var(--text)}
.ar{font:500 10px var(--fmono);letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}
.at{margin-left:auto;font:500 10px var(--fmono);color:var(--dim)}
.ap{font-size:13.5px;line-height:1.55;color:var(--body);margin-top:2px}
.ap code{font:500 12px var(--fmono);color:var(--text);background:color-mix(in srgb,var(--text) 8%,transparent);padding:0 4px;border-radius:4px}
.ap b{color:var(--text);font-weight:600}
.ap ul{margin:4px 0 0 16px;padding:0}
.live{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);font-style:italic;margin-top:4px}
.live b{font-weight:600;font-style:normal;color:var(--body)}
.av{flex:none;width:28px;height:28px;border-radius:9px;display:inline-grid;place-items:center;font:700 10.5px var(--fmono);letter-spacing:.02em}
.av.h{border-radius:50%;background:var(--accent-soft);color:var(--accent)}
.unit{display:flex;align-items:center;gap:8px;margin:8px 0 2px;font-size:12.5px;color:var(--body);flex-wrap:wrap}
.unit .sdial{width:16px;height:16px}
.unit b{color:var(--text);font-weight:600}
.unit .go{margin-left:auto;color:var(--link);font-size:12px;font-weight:600;white-space:nowrap}
.att{display:inline-flex;align-items:center;gap:8px;margin-top:6px;border:1px solid var(--card-border);background:var(--card);border-radius:10px;padding:6px 10px 6px 6px;font-size:12px;color:var(--body)}
.att .th{width:40px;height:30px;border-radius:6px;background:linear-gradient(135deg,var(--panel3),var(--border2))}
.att small{display:block;color:var(--dim);font:500 10px var(--fmono)}
.comp{flex:none;padding:8px 12px 6px}
.cbox{background:var(--card);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow-card);padding:10px 12px 9px}
.cbox .ta{font-size:14px;color:var(--dim);min-height:22px;line-height:1.45}
.cbox .ta.ink{color:var(--text)}
.crow{display:flex;align-items:center;gap:6px;margin-top:8px}
.crow .grow{flex:1}
.cchip{display:inline-flex;align-items:center;gap:5px;max-width:150px;padding:5px 10px;border-radius:999px;border:1px solid var(--border);color:var(--muted);font-size:11px;font-weight:600;white-space:nowrap;min-height:28px}
.cchip svg{opacity:.85;flex:none}
.cchip .car{font-size:8px;color:var(--dim)}
.cchip.open{color:var(--text);border-color:var(--ring);background:var(--sel-bg)}
.cchip.ico{padding:5px 7px}
.cchip .lbl{overflow:hidden;text-overflow:ellipsis}
.cnote{font:500 10.5px var(--fmono);color:var(--dim);padding:0 14px 5px;display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden}
.cnote b{color:var(--muted);font-weight:600}
.brain{display:inline-flex;align-items:center;padding:4px 8px 4px 5px;border-radius:999px;border:1px solid var(--border);min-height:28px;gap:6px}
.brain .avs{display:flex}
.brain .avs span{width:16px;height:16px;border-radius:5px;border:1px solid var(--card);margin-left:-5px;display:grid;place-items:center;font:700 7.5px var(--fmono)}
.brain .avs span:first-child{margin-left:0}
.brain small{font:600 10.5px var(--fmono);color:var(--muted)}
.replyto{display:flex;align-items:center;gap:8px;margin:0 4px 6px;padding:7px 10px;border-left:2px solid var(--link);background:var(--panel2);border-radius:6px;font-size:12px;color:var(--muted)}
.replyto b{color:var(--body);font-weight:600}
.replyto span:nth-child(2){flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.replyto .x{color:var(--dim);display:grid}
.pop{position:absolute;left:12px;right:12px;bottom:118px;background:var(--overlay);border:1px solid var(--border2);border-radius:13px;padding:7px;box-shadow:var(--shadow-pop);z-index:5}
.phint{font:500 10.5px var(--fmono);letter-spacing:.04em;color:var(--dim);padding:6px 9px 6px}
.pitem{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;min-height:40px}
.pitem.on{background:var(--sel-bg)}
.pitem.off{opacity:.55}
.pitem .pg{width:16px;display:grid;place-items:center;color:var(--body)}
.pitem .pt{flex:1;min-width:0}
.pitem .pt b{display:block;font-size:13px;font-weight:600;color:var(--text)}
.pitem .pt small{display:block;font-size:10.5px;color:var(--dim);line-height:1.35}
.pst{flex:none;width:14px;text-align:center;font-size:10px;color:var(--dim)}
.pst.on{color:var(--done)}.pst.waking{color:var(--warn)}.pst.sleep{color:var(--muted);font-size:12px}.pst.off{opacity:.6}
.ptag{font:700 9px var(--fmono);letter-spacing:.04em;text-transform:uppercase;color:var(--dim);border:1px solid var(--border2);border-radius:4px;padding:0 4px}
.pck{color:var(--text);font-size:12px}
.pfoot{padding:7px 9px 4px;font-size:10.5px;color:var(--dim);line-height:1.4}
.pfoot b{color:var(--muted);font-weight:600}
.tabs{flex:none;display:flex;justify-content:space-around;padding:8px 10px 2px;border-top:1px solid var(--border);background:var(--panel)}
.tab{display:flex;flex-direction:column;align-items:center;gap:3px;width:72px;color:var(--dim);font-size:10.5px;font-weight:600}
.tab.on{color:var(--text)}
.fab{position:absolute;right:16px;bottom:96px;width:52px;height:52px;border-radius:50%;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;box-shadow:var(--shadow-pop);z-index:3}
.segs{display:inline-flex;background:var(--panel3);border-radius:9px;padding:2px;gap:2px}
.segs span{padding:5px 12px;border-radius:7px;font-size:12px;font-weight:600;color:var(--muted)}
.segs span.on{background:var(--card);color:var(--text);box-shadow:var(--shadow-card)}
.segs.sm span{padding:3px 9px;font-size:11px}
.verb{display:flex;align-items:center;gap:10px;padding:10px 18px;color:var(--body);font-size:13.5px;font-weight:560}
.verb svg{color:var(--muted)}
.verb .k{margin-left:auto;font:500 10.5px var(--fmono);color:var(--dim)}
.scope{display:flex;align-items:center;gap:6px;padding:4px 18px 2px;font-size:12px;font-weight:600;color:var(--muted)}
.scope .mag{margin-left:auto;color:var(--muted);display:grid}
.serif{font-family:var(--fdisp);font-weight:600;letter-spacing:-.01em;line-height:1.2;color:var(--text)}
.ital{font-family:var(--fital);font-style:italic;font-weight:400;color:var(--link);text-decoration:underline dotted;text-underline-offset:3px}
.mono{font-family:var(--fmono)}
.dim{color:var(--dim)}.muted{color:var(--muted)}.bodyc{color:var(--body)}.ink{color:var(--text)}
.hr{height:1px;background:var(--border);margin:6px 16px}
.credring{position:relative;display:inline-grid;place-items:center}
.credring svg{transform:rotate(-90deg)}
.credring circle{fill:none;stroke-width:3}
.credring .tr{stroke:var(--panel3)}
.credring .ar{stroke:var(--green);stroke-linecap:round}
.credring.low .ar{stroke:var(--warn)}
.pad{padding:0 16px}
.row{display:flex;align-items:center;gap:10px}
.facts{font:500 11px var(--fmono);color:var(--dim);line-height:1.5}
.sub{font-size:12.5px;color:var(--muted);line-height:1.45}
.big{font-family:var(--fdisp);font-weight:600;font-size:26px;line-height:1.1;color:var(--text);letter-spacing:-.01em}
.big small{font-family:'Geist',sans-serif;font-size:12.5px;font-weight:500;color:var(--muted);letter-spacing:0}
.ln{display:flex;justify-content:space-between;font-size:12.5px;color:var(--body);padding:4px 0}
.ln span:last-child{color:var(--muted);font-family:var(--fmono);font-size:11.5px}
.sw{width:40px;height:24px;border-radius:12px;background:var(--brand);position:relative;flex:none}
.sw::after{content:'';position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:var(--brand-ink)}
.sw.off{background:var(--panel3)}.sw.off::after{right:auto;left:3px;background:var(--dim)}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border2);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:550;color:var(--body);min-height:32px;white-space:nowrap}
.pill.on{border-color:var(--ring);background:var(--sel-bg);color:var(--text)}
.field{display:flex;align-items:center;gap:8px;margin:0 16px;background:var(--card);border:1px solid var(--card-border);border-radius:12px;padding:9px 12px;box-shadow:var(--shadow-card);color:var(--text);font-size:14px}
.field svg{color:var(--muted)}
.field .x{margin-left:auto;color:var(--dim);display:grid}
.field.ph{color:var(--dim)}
.day{display:flex;gap:6px;padding:8px 16px 2px}
.day span{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;border-radius:10px;font-size:12.5px;font-weight:600;color:var(--body)}
.day span small{font:600 9px var(--fmono);letter-spacing:.08em;color:var(--dim)}
.day span.on{background:var(--card);border:1px solid var(--card-border);box-shadow:var(--shadow-card);color:var(--text)}
.day span.dot::after{content:'';width:4px;height:4px;border-radius:50%;background:var(--prog);margin-top:1px}
.agenda{display:flex;gap:10px;padding:7px 16px;align-items:flex-start}
.agenda .t{font:600 11px var(--fmono);color:var(--dim);width:40px;flex:none;padding-top:3px}
.agenda .g{flex:none;width:22px;height:22px;border-radius:7px;display:grid;place-items:center;color:var(--muted);background:var(--panel2)}
.agenda .g.post{border-radius:50%}
.agenda .b{flex:1;min-width:0}
.agenda .b b{display:block;font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agenda .b small{display:block;font-size:11px;color:var(--muted)}
.agenda.dimmed{opacity:.55}
.boot{margin:4px 12px 8px;padding:18px 16px 16px;border-radius:14px;background:var(--card);border:1px solid var(--card-border);box-shadow:var(--shadow-card);display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px}
.boot .orb{width:64px;height:64px;margin-bottom:8px}
.boot h3{font:400 20px/1.2 var(--fdisp);color:var(--text);letter-spacing:-.01em;margin:0}
.boot .sub b{color:var(--body);font-weight:400;font-variant-numeric:tabular-nums}
.boot .q{font-size:12px;color:var(--muted);display:flex;gap:7px;align-items:center}
.boot .q::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--green)}
.cs{display:flex;align-items:flex-start;gap:10px;padding:8px 16px}
.cs .g{flex:none;width:34px;height:34px;border-radius:10px;background:var(--panel2);display:grid;place-items:center;color:var(--body)}
.cs .b{flex:1;min-width:0}
.cs .b b{display:block;font-size:13.5px;font-weight:600;color:var(--text)}
.cs .b small{display:block;font-size:12px;color:var(--muted);line-height:1.4;margin-top:1px}
.cs .arrow{color:var(--dim);flex:none;display:grid;padding-top:8px}
.tr{display:flex;gap:8px;align-items:center;padding:5px 16px;font-size:12px;color:var(--muted)}
.tr b{color:var(--body);font-weight:600;font-size:12px}
.tr .to{margin-left:auto;font:500 10.5px var(--fmono);color:var(--dim);white-space:nowrap}
.notif{margin:0 12px 8px;padding:10px 12px;border-radius:16px;background:var(--card);border:1px solid var(--card-border);box-shadow:var(--shadow-card);display:flex;gap:10px}
.notif .app{flex:none;width:36px;height:36px;border-radius:9px;background:var(--brand);display:grid;place-items:center}
.notif .nb{flex:1;min-width:0}
.notif .nh{display:flex;align-items:baseline;gap:6px}
.notif .nh b{font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notif .nh small{margin-left:auto;font:500 10px var(--fmono);color:var(--dim)}
.notif p{margin:1px 0 0;font-size:12.5px;line-height:1.4;color:var(--body)}
.vg{display:flex;flex-wrap:wrap;gap:8px;padding:4px 16px 6px;align-items:center}
.vl{font:500 11px var(--fmono);color:var(--muted);padding:0 16px;margin-top:-2px}
.leg{display:flex;gap:10px;align-items:center;padding:5px 16px;font-size:12.5px;color:var(--body)}
.leg .w{width:22px;display:grid;place-items:center;color:var(--muted)}
.leg small{margin-left:auto;font:500 10.5px var(--fmono);color:var(--dim)}
.st-on{color:var(--done)}.st-waking{color:var(--warn)}.st-sleep{color:var(--muted)}.st-off{color:var(--dim)}
.wm{font-family:var(--fbrand);font-weight:600;font-size:27px;letter-spacing:-.015em;color:var(--text)}
.tile{width:84px;height:84px;border-radius:20px;background:#fdf6ec;border:1px solid var(--border);display:grid;place-items:center;box-shadow:var(--shadow-sheet)}
.rsn{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--body);margin-top:6px}
.rsn.on::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--green);flex:none}
.rsn.sleep::before{content:'☾';color:var(--muted);font-size:12px;flex:none}
.rsn.warn::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--warn);flex:none}
.serving{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:var(--muted)}
.serving .avs{display:flex}
.serving .avs .av{width:20px;height:20px;border-radius:6px;font-size:8px;margin-left:-4px;border:1px solid var(--card)}
.serving .avs .av:first-child{margin-left:0}
.kind{font:600 9.5px var(--fmono);letter-spacing:.06em;color:var(--dim);border:1px solid var(--border2);border-radius:4px;padding:0 5px;white-space:nowrap}
.mrow{display:flex;align-items:center;gap:10px;padding:9px 16px}
.mrow .g{width:18px;display:grid;place-items:center;color:var(--body)}
.mrow .b{flex:1;min-width:0}
.mrow .b b{display:block;font-size:13px;font-weight:600;color:var(--text)}
.mrow .b small{display:block;font-size:11px;color:var(--dim)}
.mrow .pst{width:auto;font-size:11px}
.evid{display:flex;gap:4px;padding:4px 12px 8px;overflow:hidden}
.evid span{font:600 11px var(--fmono);letter-spacing:.02em;color:var(--muted);padding:5px 9px;border-radius:8px;white-space:nowrap}
.evid span.on{background:var(--card);color:var(--text);border:1px solid var(--card-border);box-shadow:var(--shadow-card)}
.evid span i{font-style:normal;color:var(--dim)}
.rr{display:flex;align-items:center;gap:8px;padding:7px 16px;font-size:12.5px;color:var(--muted)}
.rr .w{width:18px;display:grid;place-items:center;color:var(--dim)}
.rr b{color:var(--body);font-weight:500}
.rr .n{margin-left:auto;font:500 10.5px var(--fmono);color:var(--dim)}
.think{margin:6px 16px 0 53px;font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center}
.pmode{display:inline-flex;background:var(--panel3);border-radius:8px;padding:2px;gap:2px}
.pmode span{padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;color:var(--muted)}
.pmode span.on{background:var(--card);color:var(--text);box-shadow:var(--shadow-card)}
.runrow{display:flex;align-items:center;gap:8px;padding:5px 0 5px 28px;font-size:12px;color:var(--muted)}
.runrow b{font:600 10.5px var(--fmono);color:var(--dim);width:64px;flex:none}
.rcard{margin:0 12px 8px;padding:11px 13px;border-radius:12px;background:var(--card);border:1px solid var(--card-border);box-shadow:var(--shadow-card)}
.rcard .rt{display:flex;align-items:center;gap:8px}
.rcard .rt b{flex:1;font-size:13.5px;font-weight:600;color:var(--text)}
.rcard .rm{font:500 11px var(--fmono);color:var(--muted);margin-top:3px;line-height:1.5}
.rcard .rn{display:flex;gap:14px;margin-top:6px;font-size:12px;color:var(--body)}
.rcard .rn small{display:block;font:600 9px var(--fmono);letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.rcard .door{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:var(--body)}
.rcard .door svg{color:var(--dim)}
.rcard .acts{display:flex;gap:6px;margin-top:8px}
.emp{padding:18px 16px 6px;font:400 15px/1.35 var(--fdisp);color:var(--text)}
.emp small{display:block;font:400 12.5px 'Geist',sans-serif;color:var(--muted);margin-top:4px}
.obtop{display:flex;align-items:center;gap:10px;padding:2px 16px 12px}
.obtop .wmk{display:flex;align-items:center;gap:6px;font-family:var(--fbrand);font-weight:600;font-size:17px;letter-spacing:-.015em;color:var(--text)}
.obring{position:relative;width:34px;height:34px;display:grid;place-items:center;margin-left:auto}
.obring svg{position:absolute;inset:0;transform:rotate(-90deg)}
.obring circle{fill:none;stroke-width:2.5}
.obring .trk{stroke:var(--border2)}
.obring .arc{stroke:var(--brand);stroke-linecap:round}
.obring b{font:600 10.5px var(--fmono);color:var(--text)}
.obring b i{font-style:normal;color:var(--dim)}
.obstep{font-size:12px;font-weight:600;color:var(--body)}
.obeye{font:600 9.5px var(--fmono);letter-spacing:.11em;text-transform:uppercase;color:var(--dim);padding:6px 16px 4px}
.obtitle{font:600 24px/1.15 var(--fdisp);letter-spacing:-.01em;color:var(--text);padding:0 16px}
.obtitle .acc{color:var(--accent)}
.obsub{font-size:13.5px;line-height:1.5;color:var(--muted);padding:8px 16px 0}
.obsub b{color:var(--body);font-weight:600}
.obfield{margin:14px 16px 0;background:var(--card);border:1px solid var(--card-border);border-radius:12px;padding:11px 12px;font-size:15px;color:var(--text);box-shadow:var(--shadow-card)}
.obfield.ph{color:var(--dim)}
.obslug{display:flex;align-items:center;margin:8px 16px 0;background:var(--card);border:1px solid var(--card-border);border-radius:12px;padding:10px 12px;box-shadow:var(--shadow-card);font:500 13px var(--fmono)}
.obslug .pre{color:var(--dim)}
.obslug .val{color:var(--text)}
.obhint{font:500 11px var(--fmono);color:var(--dim);padding:8px 16px 0;line-height:1.55}
.obmach{display:flex;align-items:center;gap:12px;margin:16px 16px 0;padding:12px 13px;background:var(--card);border:1px solid var(--card-border);border-radius:12px;box-shadow:var(--shadow-card)}
.obmach .g{width:34px;height:34px;border-radius:10px;background:var(--panel2);display:grid;place-items:center;color:var(--body);flex:none}
.obmach .b{flex:1;min-width:0}
.obmach .b b{display:block;font-size:13.5px;font-weight:600;color:var(--text)}
.obmach .b small{display:block;font:500 11px var(--fmono);color:var(--dim);margin-top:2px}
.obdot{width:8px;height:8px;border-radius:50%;background:var(--warn);flex:none}
.obdot.on{background:var(--green)}
.obnav{display:flex;align-items:center;gap:8px;padding:12px 16px 10px;margin-top:auto}
.obnav .sp{flex:1}
.prov{display:flex;align-items:center;gap:10px;margin:8px 16px 0;padding:10px 12px;background:var(--card);border:1px solid var(--card-border);border-radius:12px;box-shadow:var(--shadow-card)}
.prov .pl{width:28px;height:28px;border-radius:8px;background:var(--panel2);display:grid;place-items:center;font:700 11px var(--fmono);color:var(--body);flex:none}
.prov .pb{flex:1;min-width:0}
.prov .pb b{display:block;font-size:13px;font-weight:600;color:var(--text)}
.prov .pb small{display:block;font-size:11px;color:var(--dim);line-height:1.35}
.prov .pm{display:inline-flex;gap:4px;flex:none}
.prov .pm span{font:600 10px var(--fmono);letter-spacing:.04em;padding:4px 7px;border-radius:999px;border:1px solid var(--border2);color:var(--muted)}
.prov .pm span.on{border-color:var(--ring);background:var(--sel-bg);color:var(--text)}
.obskip{margin:14px 16px 0;padding:13px 14px;border-radius:14px;background:var(--card);border:1px solid var(--ring);box-shadow:var(--shadow-card)}
.obskip b{display:block;font-size:14px;color:var(--text)}
.obskip small{display:block;font-size:12px;color:var(--muted);margin-top:2px;line-height:1.45}
.obskip .btn{margin-top:10px;width:100%}
.crewcard{display:flex;align-items:center;gap:10px;margin:7px 16px 0;padding:8px 12px;background:var(--card);border:1px solid var(--card-border);border-radius:12px;box-shadow:var(--shadow-card)}
.crewcard .cb{flex:1;min-width:0}
.crewcard .cb b{display:block;font-size:13.5px;font-weight:600;color:var(--text)}
.crewcard .cb small{display:block;font:500 10px var(--fmono);letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}
.crewcard .mdl{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:4px 9px;white-space:nowrap}
.reveal{display:flex;flex-wrap:wrap;justify-content:center;gap:14px 12px;padding:18px 16px 6px}
.reveal .m{display:flex;flex-direction:column;align-items:center;gap:4px;width:100px}
.reveal .m .av{width:48px;height:48px;border-radius:14px;font-size:15px;position:relative}
.reveal .m .av i{position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;background:var(--green);border:2px solid var(--bg)}
.reveal .m b{font-size:12.5px;color:var(--text);font-weight:600}
.reveal .m small{font:500 9.5px var(--fmono);letter-spacing:.05em;text-transform:uppercase;color:var(--dim)}
.stats{display:flex;justify-content:center;gap:18px;padding:10px 16px 0;font-size:12.5px;color:var(--muted)}
.stats b{color:var(--text);font-weight:600}
.attr{font:500 10.5px var(--fmono);color:var(--dim);padding:4px 16px 0 53px}
.setup{margin:4px 12px 8px;padding:11px 13px;background:var(--card);border:1px solid var(--card-border);border-radius:12px;box-shadow:var(--shadow-card)}
.setup .sh{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.setup .sh b{flex:1;font-size:13px;color:var(--text)}
.setup .sh small{font:600 10.5px var(--fmono);color:var(--dim)}
.sti{display:flex;align-items:center;gap:9px;padding:6px 0;font-size:12.5px;color:var(--body)}
.sti .bx{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--border2);display:grid;place-items:center;color:var(--brand-ink);flex:none}
.sti.done .bx{background:var(--green);border-color:var(--green)}
.sti.done span{color:var(--muted);text-decoration:line-through}
.sti .verb{margin-left:auto;color:var(--link);font-weight:600;font-size:12px}
.wstile{width:38px;height:38px;border-radius:11px;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;font:700 15px var(--fmono);flex:none}
.sheetk{font:500 10.5px var(--fmono);color:var(--dim);display:flex;align-items:center;gap:6px;padding:8px 16px}
.clerk{margin:10px 16px 0;padding:18px 16px;background:var(--card);border:1px solid var(--card-border);border-radius:16px;box-shadow:var(--shadow-card);display:flex;flex-direction:column;gap:10px}
.clerk h4{margin:0;font:600 22px/1.2 var(--fdisp);color:var(--text)}
.oauth{display:flex;gap:8px}
.oauth .btn{flex:1}
.ordiv{display:flex;align-items:center;gap:8px;font:500 10.5px var(--fmono);color:var(--dim)}
.ordiv::before,.ordiv::after{content:'';flex:1;height:1px;background:var(--border)}
.invtile{display:flex;align-items:center;gap:12px;margin:14px 16px 0;padding:12px;background:var(--card);border:1px solid var(--card-border);border-radius:12px;box-shadow:var(--shadow-card)}
.invtile .b b{display:block;font-size:13.5px;font-weight:600;color:var(--text)}
.invtile .b small{display:block;font-size:11.5px;color:var(--dim)}
.orsep{text-align:center;font:500 10.5px var(--fmono);color:var(--dim);padding:8px 0}
`;
