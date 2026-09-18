// Generates the artboards for the routine hands-off round (2026-09-16): the routine's own thread
// (opener, the old dead end, the resumed re-ask, rex's "started" reply with the unit card) and the
// unit's thread (the routine-run plan record, the design round auto-approved, the offer, the claim).
// Recipes are lifted from tokens.css (.msg, .rolechip, .focard.sent, .unitcard, .routinechip, .thead)
// and the two palettes from the same file. Run: node build.mjs
import { writeFileSync } from 'node:fs';

const THEMES = {
  graphite: { bg: '#141414', panel: '#161616', panel2: '#1a1a1a', panel3: '#262626', border: '#262626', border2: '#3a3a3a', cardBorder: '#2c2c2c',
    text: '#cbcbcb', body: '#a6a6a6', muted: '#848484', dim: '#6a6a6a', link: '#d19a72', brand: '#834a2b', brandInk: '#fff7ee',
    green: '#77ac8d', warn: '#c9a15e', prog: '#8ba0c0', planrev: '#a89ccf', design: '#cc8fb9', review: '#a89ccf', acc: '#6fb0ab', todo: '#949494',
    orch: '#9793d2', roleDesign: '#cc8fb9', roleMkt: '#c98f8f', card: '#1e1e1e', btn: '#232323', btnFg: '#efefef', hoverBg: 'color-mix(in srgb, #cbcbcb 7%, transparent)' },
  cream: { bg: '#fbf8f4', panel: '#fbf8f4', panel2: '#f6eee1', panel3: '#efe1cd', border: '#e6dbca', border2: '#d3c2a8', cardBorder: '#eadfce',
    text: '#3a2c22', body: '#5b4c3d', muted: '#8b7861', dim: '#a99680', link: '#9c5730', brand: '#834a2b', brandInk: '#fff7ee',
    green: '#2f9e6b', warn: '#a06a1f', prog: '#4f80c4', planrev: '#7d56b8', design: '#b0498f', review: '#6d5ce0', acc: '#2f8f8a', todo: '#7d8590',
    orch: '#6a63bc', roleDesign: '#b0498f', roleMkt: '#b04f55', card: '#ffffff', btn: '#f8f2e8', btnFg: '#43301f', hoverBg: 'color-mix(in srgb, #3a2c22 5%, transparent)' },
};
const tokens = (t) => Object.entries({
  '--bg': t.bg, '--panel': t.panel, '--panel2': t.panel2, '--panel3': t.panel3, '--border': t.border, '--border2': t.border2, '--card-border': t.cardBorder,
  '--text': t.text, '--body': t.body, '--muted': t.muted, '--dim': t.dim, '--link': t.link, '--brand': t.brand, '--brand-ink': t.brandInk,
  '--green': t.green, '--warn': t.warn, '--prog': t.prog, '--planrev': t.planrev, '--design': t.design, '--review': t.review, '--acc': t.acc, '--todo': t.todo,
  '--role-orch': t.orch, '--role-design': t.roleDesign, '--role-mkt': t.roleMkt, '--card': t.card, '--btn': t.btn, '--btn-fg': t.btnFg, '--hover-bg': t.hoverBg,
}).map(([k, v]) => `${k}:${v};`).join('');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@500;600&amp;display=swap">';

const CSS = `
  body { margin: 0; }
  .sheet { --fbody: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; --fmono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    position: relative; box-sizing: border-box; background: var(--bg); color: var(--text); font: 14px/1.5 var(--fbody); -webkit-font-smoothing: antialiased; overflow: hidden; }
  .sheet *, .sheet *::before, .sheet *::after { box-sizing: border-box; }
  /* the thread header: crumb · room · title · chips (ConvoThread / ThreadHead) */
  .thead { display: flex; align-items: center; gap: 10px; padding: 14px 22px 12px; border-bottom: 1px solid var(--border); }
  .scrumb { color: var(--muted); font-size: 12.5px; }
  .crumb { color: var(--dim); font: 500 11px var(--fmono); letter-spacing: -.02em; display: inline-flex; align-items: center; gap: 6px; }
  .crumb .proj { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }
  .crumb .logo { width: 12px; height: 12px; border-radius: 3px; background: var(--brand); display: inline-block; }
  .ttl { font-weight: 500; font-size: 14px; color: var(--text); letter-spacing: -.005em; }
  .num { font: 600 12px var(--fmono); color: var(--dim); }
  .chip { display: inline-flex; align-items: center; gap: 5px; font: 500 10px var(--fmono); letter-spacing: -.02em; padding: 3px 7px; border-radius: 3px; text-transform: uppercase; white-space: nowrap; }
  .c-plan_review { background: color-mix(in srgb, var(--planrev) 16%, transparent); color: var(--planrev); }
  .c-in_progress { background: color-mix(in srgb, var(--prog) 16%, transparent); color: var(--prog); }
  .c-kind { background: color-mix(in srgb, var(--role-mkt) 13%, transparent); color: var(--role-mkt); }
  .routinechip { flex: none; display: inline-flex; align-items: center; gap: 4px; font: 600 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--border2); border-radius: 3px; padding: 2.5px 8px; }
  .dial { display: inline-flex; align-items: center; gap: 6px; color: var(--dim); font: 500 11px var(--fmono); }
  .dial svg { display: block; }
  .theadact { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .settle { border: 1px solid var(--border2); background: var(--card); color: var(--text); font: 600 9.5px var(--fmono); border-radius: 3px; padding: 3px 8px; text-transform: uppercase; }
  .stack { padding: 8px 12px 20px; max-width: 860px; }
  /* one message row, the shipped anatomy */
  .msg { display: flex; gap: 11px; padding: 7px 10px; border-radius: 6px; position: relative; }
  .msg .av { width: 26px; height: 26px; min-width: 26px; border-radius: 4px; display: grid; place-items: center; font-weight: 600; font-size: 11px; color: var(--body); background: var(--panel3); box-shadow: inset 0 0 0 1px var(--border2); }
  .msg .pav { width: 26px; height: 26px; min-width: 26px; border-radius: 4px; display: grid; place-items: center; background: var(--panel3); box-shadow: inset 0 0 0 1px var(--border2); }
  .msg .pav svg { display: block; }
  .msg .body { min-width: 0; flex: 1; }
  .msg .head { display: flex; align-items: center; gap: 8px; }
  .msg .head b { font-size: 12.5px; font-weight: 600; }
  .rolechip { font-size: 6.5px; font-weight: 600; letter-spacing: -.02em; text-transform: uppercase; padding: 1.5px 4.5px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 16%, transparent); color: var(--muted); }
  .rolechip.orch { color: color-mix(in srgb, var(--role-orch) 80%, var(--muted)); }
  .rolechip.design { color: color-mix(in srgb, var(--role-design) 80%, var(--muted)); }
  .rolechip.mkt { color: color-mix(in srgb, var(--role-mkt) 80%, var(--muted)); }
  .msg .time { font-size: 10.5px; color: var(--dim); }
  .msg p { color: var(--body); margin: 3px 0 0; overflow-wrap: anywhere; }
  .msg p b, .msg p strong { color: var(--text); font-weight: 600; }
  .msg p a { color: var(--link); text-decoration: none; }
  .msg.human.mine .av { color: var(--brand-ink); background: var(--brand); box-shadow: none; }
  .quiet p { color: var(--muted); }
  /* the compact record (focard.sent) — the plan card once approved, the design round once approved */
  .focard { border: 1px solid var(--card-border); background: var(--card); border-radius: 6px; padding: 12px 13px; margin: 6px 0; max-width: 520px; }
  .focard.sent { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 7px; padding: 7px 12px; background: color-mix(in srgb, var(--text) 3%, transparent); border-color: var(--border); }
  .focard.sent .fotick { color: var(--muted); font-weight: 600; } .focard.sent .foq { color: var(--muted); } .focard.sent .foa { font-weight: 600; }
  .planopenlink { font: 500 11.5px var(--fmono); color: var(--link); margin-left: 4px; }
  /* the unit card (thread-owned work): id · title · chip · dial, then the status line */
  .unitcard { display: flex; flex-direction: column; gap: 5px; width: 100%; max-width: 520px; margin: 6px 0 2px; }
  .uchead { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .ucid { font: 600 11.5px var(--fmono); color: var(--link); flex: none; }
  .ucti { font-weight: 630; font-size: 13px; letter-spacing: -.008em; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
  .ucline { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
  .ring { display: inline-flex; gap: 2px; align-items: center; }
  .ring i { display: block; width: 14px; height: 4px; border-radius: 2px; background: var(--border2); }
  .ring i.on { background: var(--planrev); } .ring i.on.d { background: var(--design); } .ring i.on.b { background: var(--prog); } .ring i.on.a { background: var(--acc); }
  .ring i.dash { background: repeating-linear-gradient(90deg, var(--border2) 0 3px, transparent 3px 5px); }
  /* the thread composer, reduced to what the chip needs: box, hint row, the foot with the brain chip */
  .cbox { position: relative; margin: 18px 10px 0; background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px 10px; }
  .cta { min-height: 34px; font-size: 13.5px; color: var(--dim); }
  .cfoot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .cchip { display: inline-flex; align-items: center; gap: 6px; padding: 3.5px 8px; border-radius: 3px; border: 1px solid var(--border2); color: var(--muted); font: 600 11.5px var(--fbody); white-space: nowrap; }
  .cchip.brain { color: var(--text); background: var(--panel2); }
  .cchip .n { font: 600 9.5px var(--fmono); color: var(--link); padding: 1px 5px; border-radius: 3px; background: color-mix(in srgb, var(--link) 14%, transparent); }
  .csp { flex: 1; }
  .csend { width: 32px; height: 32px; border-radius: 999px; background: var(--brand); color: var(--brand-ink); display: grid; place-items: center; font-size: 13px; }
  .bpop { position: absolute; left: 118px; bottom: 132px; width: 340px; background: var(--card); border: 1px solid var(--border2); border-radius: 8px; padding: 10px 12px; box-shadow: 0 20px 55px -14px rgba(0,0,0,.45); }
  .bpop .h { font: 600 9.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--dim); margin-bottom: 8px; display: flex; gap: 8px; }
  .bpop .h b { color: var(--text); }
  .brow { display: grid; grid-template-columns: 22px 78px 1fr; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; color: var(--body); }
  .brow .rk { font: 600 9px var(--fmono); text-transform: uppercase; color: var(--dim); }
  .brow .mv { color: var(--text); font-weight: 500; }
  .brow .mv .why { color: var(--muted); font-weight: 400; font-size: 11px; margin-left: 6px; }
  .brow .pav, .brow .av { width: 22px; height: 22px; min-width: 22px; font-size: 9px; }
  .bfoot { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); }
  /* the brain popup, Roles view — the shipped recipes at the 340px compression */
  .bp2 { position: relative; width: 340px; background: var(--card); border: 1px solid var(--border2); border-radius: 8px; box-shadow: 0 18px 50px -14px rgba(0,0,0,.5); display: flex; flex-direction: column; }
  .bp2 .tabs { display: flex; align-items: center; gap: 2px; padding: 7px 9px 0; }
  .bp2 .tab { font: 500 12px var(--fbody); color: var(--muted); padding: 5px 12px; border-radius: 3px; }
  .bp2 .tab.on { color: var(--text); background: var(--panel2); }
  .bp2 .tabn { font: 600 10px var(--fmono); color: var(--dim); margin-left: 5px; }
  .bp2 .tabnote { margin-left: auto; padding-right: 6px; font: 600 10px var(--fmono); color: var(--muted); }
  .bp2 .head { padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .bp2 .scope { display: inline-flex; gap: 2px; background: var(--panel2); border-radius: 6px; padding: 3px; }
  .bp2 .scope span { font: 500 10.5px var(--fbody); color: var(--muted); padding: 4px 10px; border-radius: 6px; }
  .bp2 .scope span.on { background: var(--card); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.2); }
  .bp2 .rows { padding: 6px 8px 8px; display: flex; flex-direction: column; }
  .bp2 .row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; }
  .bp2 .role { font: 500 8.5px var(--fmono); letter-spacing: -.02em; text-transform: uppercase; color: var(--muted); width: 68px; flex: none; }
  .bp2 .who { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
  .bp2 .who b { font-size: 12px; font-weight: 500; color: var(--text); }
  .bp2 .who span { font-size: 9.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bp2 .model { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 5px; font: 500 10px var(--fmono); color: var(--body); border: 1px solid var(--card-border); background: var(--panel); border-radius: 6px; padding: 3px 7px; }
  .bp2 .model .car { color: var(--dim); font-size: 8px; }
  .bp2 .model.pinned { opacity: .55; }
  .bp2 .pav, .bp2 .av { width: 18px; height: 18px; min-width: 18px; border-radius: 6px; font-size: 8px; }
  .bp2 .foot { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); }
  .bp2 .foot .sp { flex: 1; }
  .bp2 .mini { font: 600 10px var(--fbody); color: var(--dim); padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border2); }
  .bp2 .mini.starter { color: var(--text); border-color: var(--border2); background: var(--panel2); }
  .bp2 .apply { background: var(--brand); color: var(--brand-ink); font: 600 11px var(--fbody); padding: 6.5px 14px; border-radius: 6px; opacity: .6; }
  .bp2 .apply.live { opacity: 1; }
  /* the brain notice (F): the attention bar's anatomy docked above the composer — head, then rows */
  .bnwrap { margin: 14px 10px 0; }
  .bnbar { display: flex; align-items: center; gap: 9px; width: 100%; background: var(--panel2); border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 6px; padding: 7px 12px 7px 11px; font-size: 12.5px; }
  .bnbar.switched, .bnpanel.switched { border-left-color: var(--muted); }
  .bnbar .g { flex: none; width: 15px; height: 15px; color: var(--warn); } .bnbar.switched .g { color: var(--muted); }
  .bnbar .g svg { display: block; width: 100%; height: 100%; }
  .bnbar .t { flex: none; font-weight: 500; color: var(--text); }
  .bnbar .s { flex: 1; min-width: 0; color: var(--body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bnbar .c { flex: none; margin-left: auto; color: var(--muted); font-size: 9px; }
  .bnpanel { margin: 14px 10px 0; background: var(--panel2); border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 6px; overflow: hidden; }
  .bnpanel .bnbar { border: none; border-radius: 0; margin: 0; }
  .bnrow { display: grid; grid-template-columns: 104px 1fr; gap: 10px; padding: 10px 14px 11px 13px; border-top: 1px solid var(--border); }
  .bnk { font: 500 10.5px var(--fmono); letter-spacing: -.01em; text-transform: uppercase; color: var(--muted); padding-top: 2px; }
  .bnv { font-size: 12px; line-height: 1.55; color: var(--body); }
  .bnacts { display: flex; gap: 8px; align-items: flex-start; }
  .authcard { border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border2)); background: var(--panel); border-radius: 8px; padding: 11px 13px; font-size: 12.5px; line-height: 1.5; flex: 1 1 360px; }
  .authcard.switched { border-color: var(--border2); }
  .authcard .h { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .authcard .h i { width: 7px; height: 7px; border-radius: 999px; background: var(--warn); display: inline-block; } .authcard.switched .h i { background: var(--muted); }
  .authcard .sub { color: var(--dim); font-size: 11.5px; margin: 6px 0 10px; }
  .authcard .cmd { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 11px; color: var(--dim); }
  .authcard .cmd code { font: 500 11.5px var(--fmono); background: var(--panel3); padding: 3px 8px; border-radius: 4px; color: var(--text); }
  .authcard .foot { display: flex; flex-wrap: wrap; gap: 7px; }
  .btn { display: inline-flex; align-items: center; font: 600 10.5px var(--fmono); text-transform: uppercase; letter-spacing: -.01em; padding: 6px 10px; border-radius: 3px; border: 1px solid var(--border2); background: var(--btn); color: var(--btn-fg); }
  .btn.primary { background: var(--brand); color: var(--brand-ink); border-color: var(--brand); }
  .lbl { margin: 18px 10px 0; font: 600 9.5px var(--fmono); letter-spacing: -.01em; text-transform: uppercase; color: var(--dim); }
  /* the note under an artboard */
  .note { position: absolute; left: 22px; right: 22px; bottom: 16px; color: var(--dim); font: 500 10.5px var(--fmono); letter-spacing: -.01em; }
  .note b { color: var(--muted); font-weight: 600; }
`;

const AV = {
  geo: '<span class="av">G</span>',
  rex: '<span class="pav"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="3" stroke="currentColor" stroke-width="1.3" opacity=".7"/><circle cx="6" cy="8" r="1.1" fill="currentColor" opacity=".8"/><circle cx="10" cy="8" r="1.1" fill="currentColor" opacity=".8"/></svg></span>',
  iris: '<span class="pav"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.3" opacity=".7"/><circle cx="8" cy="8" r="2" fill="currentColor" opacity=".8"/></svg></span>',
  plume: '<span class="pav"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13c2-6 5-9 10-10-1 5-4 8-10 10Z" stroke="currentColor" stroke-width="1.3" opacity=".7"/></svg></span>',
};
const ROLE = { rex: '<span class="rolechip orch">orchestrator</span>', iris: '<span class="rolechip design">designer</span>', plume: '<span class="rolechip mkt">marketer</span>' };

function msg({ who, name, at, html, human = false, quiet = false }) {
  return `<div class="msg${human ? ' human mine' : ''}${quiet ? ' quiet' : ''}">${AV[who]}<div class="body"><div class="head"><b>${name}</b>${ROLE[who] ?? ''}<span class="time">${at}</span></div>${html}</div></div>`;
}
const record = (q, a, link) => `<div class="focard sent"><span class="fotick">✓</span><span class="foq">${q}</span><span class="foa">${a}</span>${link ? `<span class="planopenlink">open ${link}</span>` : ''}</div>`;
const ring = (on) => `<span class="ring">${['p', 'd', 'b', 'a'].map((l, i) => `<i class="${i < on ? `on ${l}` : i === on ? 'dash' : ''}"></i>`).join('')}</span>`;
const unitcard = (state, line, on, n = 1094) => `<div class="unitcard"><span class="uchead"><span class="ucid">#${n}</span><span class="ucti">Draft the Flowe X calendar, Sep 14 to 20</span><span class="chip c-${state}">${state.replace('_', ' ')}</span>${ring(on)}</span><span class="ucline">${line}</span></div>`;
const ask = 'hey rex, can we do some research and come up with tweets drafts for flowe for the x platform to be scheduled for the coming week; 7 tweets, one per day, 3 to 4 of them should include images';

const dialSvg = (n, total) => `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="color-mix(in srgb, var(--dim) 30%, transparent)" stroke-width="2"/><circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--prog)" stroke-width="2" stroke-dasharray="${(34.56 * n / total).toFixed(1)} 34.56" transform="rotate(-90 7 7)"/></svg>${n}/${total}`;

// A · the routine's own thread
const routineHead = `<div class="thead"><span class="scrumb">‹ #marketing</span><span class="crumb"><span class="proj"><span class="logo"></span>Flowe AI</span> › # marketing</span><span class="ttl">Routine · Flowe X Schedule for Upcoming Week</span><span class="routinechip">◷ routine</span><div class="theadact"><span class="settle">Settle</span></div></div>`;
const routineBody = (theme) => `${routineHead}<div class="stack">
  ${msg({ who: 'geo', name: 'geo', at: '08:30 AM', human: true, html: `<p><b>Routine · Flowe X Schedule for Upcoming Week</b></p><p>${ask}</p>` })}
  ${msg({ who: 'rex', name: 'rex', at: '08:30 AM', quiet: true, html: `<p>I can't run this right now. No machine available to me can serve claude-code. Sign in to a provider on this machine, or ask a teammate to lend you theirs in Settings › Compute › Sharing.</p>` })}
  ${msg({ who: 'geo', name: 'geo', at: '11:35 PM', human: true, html: `<p><b>Routine resumed · Flowe X Schedule for Upcoming Week</b></p><p>${ask}</p>` })}
  ${msg({ who: 'rex', name: 'rex', at: '11:36 PM', html: `<p>Started <a>#1094</a> for the seven-post Flowe X calendar. This run is hands-off: the plan and the image round are approved by the routine, and you get one notification when the drafts are ready.</p>${unitcard('plan_review', 'approved · awaiting its offer', 1)}` })}
</div>
<div class="note"><b>A · THE ROUTINE'S THREAD</b> · the opener, the old dead end (a compute notice is not an answer), the re-ask the host posts as the owner once compute is back, and rex's started reply with the unit card. No new component. Theme: ${theme}.</div>`;

// C · the routine thread on Pro: the seat is the Starter model, and the composer says so
const proHead = `<div class="thead"><span class="scrumb">‹ #marketing</span><span class="crumb"><span class="proj"><span class="logo"></span>Flowe AI</span> › # marketing</span><span class="ttl">Routine · Flowe X Schedule for Upcoming Week</span><span class="routinechip">◷ routine</span><div class="theadact"><span class="settle">Settle</span></div></div>`;
const proBody = (theme) => `${proHead}<div class="stack" style="position:relative">
  ${msg({ who: 'geo', name: 'geo', at: '08:30 AM', human: true, html: `<p><b>Routine · Flowe X Schedule for Upcoming Week</b></p><p>${ask}</p>` })}
  ${msg({ who: 'rex', name: 'rex', at: '08:31 AM', html: `<p>Started <a>#1094</a> for the seven-post Flowe X calendar. This run is hands-off and runs on the cloud on credits: the plan and the image round are approved by the routine, and you get one notification when the drafts are ready.</p>${unitcard('plan_review', 'approved · awaiting its offer', 1)}` })}
  <div style="height: 250px"></div>
  <div class="cbox"><div class="cta">Reply in this thread · @ mention · / skill · ↵ send</div>
    <div class="cfoot"><span class="cchip">@</span><span class="cchip"># marketing</span><span class="cchip brain">◉ Brain <span class="n">1 changed here</span></span><span class="csp"></span><span class="csend">↑</span></div></div>
  <div class="bpop"><div class="h">This thread <b>Routine · Flowe X Schedule…</b></div>
    <div class="brow">${AV.rex}<span class="rk">orchestrator</span><span class="mv">NeuraMesh brain (Starter v1)<span class="why">· routine on Pro</span></span></div>
    <div class="brow">${AV.iris}<span class="rk">designer</span><span class="mv" style="color:var(--body);font-weight:400">Claude Sonnet 5</span></div>
    <div class="brow">${AV.plume}<span class="rk">marketer</span><span class="mv" style="color:var(--body);font-weight:400">GPT-5.6 Sol</span></div>
    <div class="bfoot">The routine's seat runs on credits, on your cloud machine. The other seats run where their logins are.</div></div>
</div>
<div class="note"><b>C · THE ROUTINE ON PRO</b> · the same thread, born with the orchestrator on the Starter model (server-stamped). The composer's brain chip counts the one seat that changed; its popup names it and why. rex's reply says the run went to the cloud on credits. Theme: ${theme}.</div>`;

// D · the notice with its reason (a human conversation, Free, the Claude login lapsed on the Mac)
const noticeHead = `<div class="thead"><span class="scrumb">‹ #marketing</span><span class="crumb"><span class="proj"><span class="logo"></span>Flowe AI</span> › # marketing</span><span class="ttl">Pricing page copy</span><div class="theadact"><span class="settle">Settle</span></div></div>`;
const noticeBody = (theme) => `${noticeHead}<div class="stack">
  ${msg({ who: 'geo', name: 'geo', at: '07:22 AM', human: true, html: `<p>rex, can you tighten the pricing page copy? Three tiers, one line each.</p>` })}
  ${msg({ who: 'rex', name: 'rex', at: '07:22 AM', quiet: true, html: `<p>I can't run this now. The Claude login on this machine expired. Your cloud machine has no Claude login either. Sign in to Claude again on this machine, or ask a teammate to lend you a machine in Settings › Compute › Sharing.</p>` })}
</div>
<div class="note"><b>D · THE NOTICE SAYS WHY</b> · the same stop, with the reason the machine's own credential probe already knows: the login expired (or was never made), and the cloud machine has none either. One sentence of reason, one instruction. Before: “no machine available to me can serve claude-code”. Theme: ${theme}.</div>`;

// E · the brain popup, Roles view: the one-tap switch, before and after
const seatRow = (av, role, name, note, model, pinned) => `<div class="row">${av}<span class="role">${role}</span><span class="who"><b>${name}</b>${note ? `<span>${note}</span>` : ''}</span><span class="model${pinned ? ' pinned' : ''}">${model} <span class="car">▾</span></span></div>`;
const popup = (after) => `<div class="bp2">
  <div class="tabs"><span class="tab on">Roles <span class="tabn">4</span></span><span class="tab">Packs</span>${after ? '<span class="tabnote">4 changed here</span>' : ''}</div>
  <div class="head"><span class="scope"><span class="on">This thread</span><span>Project-wide</span></span></div>
  <div class="rows">
    ${seatRow(AV.rex, 'orchestrator', 'rex', after ? 'set for this conversation' : '', after ? 'NeuraMesh brain (Starter v1)' : 'GPT-5.6 Sol', false)}
    ${seatRow(AV.iris, 'designer', 'iris', after ? 'set for this conversation' : '', after ? 'NeuraMesh brain (Starter v1)' : 'Claude Sonnet 5', false)}
    ${seatRow(AV.plume, 'marketer', 'plume', after ? 'set for this conversation' : '', after ? 'NeuraMesh brain (Starter v1)' : 'GPT-5.6 Sol', false)}
    ${seatRow(AV.rex, 'reviewer', 'scout', after ? 'set for this conversation' : '', after ? 'NeuraMesh brain (Starter v1)' : 'Claude Sonnet 5', false)}
  </div>
  <div class="foot"><span>${after ? '4 roles set here' : ''}</span><span class="sp"></span>${after ? '<span class="mini">Reset</span>' : '<span class="mini starter">Use NeuraMesh brain here</span>'}<span class="apply${after ? '' : ''}">Apply</span></div>
</div>`;
const switchHead = `<div class="thead"><span class="scrumb">‹ #marketing</span><span class="crumb"><span class="proj"><span class="logo"></span>Flowe AI</span> › # marketing</span><span class="ttl">Flowe X calendar, the week of Sep 21</span><div class="theadact"><span class="settle">Settle</span></div></div>`;
const switchBody = (theme, after) => `${switchHead}<div class="stack">
  ${msg({ who: 'geo', name: 'geo', at: '09:12 AM', human: true, html: `<p>rex, plan the Flowe X calendar for the week of Sep 21. Seven posts, three with images. Run it on the Starter brain this time, I am out of Claude credits on this Mac.</p>` })}
  ${after ? msg({ who: 'rex', name: 'rex', at: '09:13 AM', html: `<p>Started <a>#1096</a>. Every seat in this conversation runs on the NeuraMesh brain now: iris draws the image directions, plume drafts the seven posts, scout reviews, all on credits.</p>${unitcard('plan_review', 'approved · awaiting its offer', 1, 1096)}` }) : ''}
  <div style="height: 300px"></div>
  <div class="cbox"><div style="position:absolute; left: 130px; bottom: calc(100% + 8px);">${popup(after)}</div><div class="cta">Reply in this thread · @ mention · / skill · ↵ send</div>
    <div class="cfoot"><span class="cchip">@</span><span class="cchip"># marketing</span><span class="cchip brain">◉ Brain ${after ? '<span class="n">4 changed here</span>' : ''}</span><span class="csp"></span><span class="csend">↑</span></div></div>
</div>
<div class="note"><b>E · USE STARTER HERE</b> · ${after ? 'after: every unpinned seat moved in one apply; the chip counts them, the rows say so, Reset undoes it. The unit’s legs and any spawned subagents take the seat on their next turn.' : 'before: the Roles view as shipped, with the one new control in its foot. The per-seat picker also lists the house model as “runs on us”, no provider needed.'} Theme: ${theme}.</div>`;

// B · the unit's thread
const unitHead = `<div class="thead"><span class="scrumb">‹ Home</span><span class="crumb"><span class="proj"><span class="logo"></span>Flowe AI</span> › # marketing</span><span class="num">#1094</span><span class="chip c-in_progress">in progress</span><span class="chip c-kind">content</span><span class="dial">${dialSvg(3, 4)}</span><div class="theadact"><span class="settle">Settle</span></div></div>`;
const unitBody = (theme) => `${unitHead}<div class="stack">
  ${msg({ who: 'rex', name: 'rex', at: '11:36 PM', html: `<p>◷ Routine run. Implementation plan <b>v1</b> (implementation-plan-v1.md). Work starts now, hands-off. You get a notification when it is done.</p>${record('Implementation plan v1', 'auto-approved · routine', 'implementation-plan-v1.md')}` })}
  ${msg({ who: 'iris', name: 'iris', at: '11:37 PM', html: `<p>iris here. I study the brand guidelines before I draft round 1 of #1094. The image directions land in this thread.</p>` })}
  ${msg({ who: 'iris', name: 'iris', at: '11:44 PM', html: `<p>Design mockups proposed for #1094: 3 mockups in the artifacts (<b>design-mockup-v1-…</b>). Three image directions for the picture posts: a breath-cycle diagram, a quiet desk scene, and a stat card.</p>` })}
  ${msg({ who: 'rex', name: 'rex', at: '11:44 PM', html: `<p>✓ Design round 1 auto-approved · routine run. The round is the visual contract for the work. The build starts now.</p>` })}
  ${msg({ who: 'rex', name: 'rex', at: '11:44 PM', quiet: true, html: `<p>Plan approved. Offered #1094 to <a>@plume</a> for execution.</p>` })}
  ${msg({ who: 'plume', name: 'plume', at: '11:45 PM', html: `<p>Claimed #1094 “Draft the Flowe X calendar, Sep 14 to 20”. Seven posts, one per day, three with images built to round 1. I post the drafts here when they are ready.</p>` })}
</div>
<div class="note"><b>B · THE UNIT'S THREAD</b> · the routine-run plan message with its compact record, the designer's round, the round auto-approved by the routine (one server-posted line, authored by the unit’s creator), the mechanical offer, the claim. The human reads a run, not a queue of asks. Theme: ${theme}.</div>`;

// F · the docked brain notice — the two states, each collapsed and expanded (George, 2026-09-17:
// "easily missed, so a needs-you / warning item above the composer the user can expand")
const WARN = '<svg viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M7.5 1.8 14 13H1z" stroke-linejoin="round"/><path d="M7.5 6v3.4" stroke-linecap="round"/><circle cx="7.5" cy="11.1" r=".7" fill="currentColor" stroke="none"/></svg>';
const bnHead = (state, title, summary, open) => `<div class="bnbar ${state}"><span class="g">${WARN}</span><span class="t">${title}</span>${open ? '' : `<span class="s">${summary}</span>`}<span class="c">${open ? '▲' : '▼'}</span></div>`;
const authCard = (switched) => switched
  ? `<div class="authcard switched"><div class="h"><i></i>Switched to the NeuraMesh brain here</div><div class="sub">This machine has no OpenAI / Codex login. This conversation runs <b>@rex</b> on the NeuraMesh brain, on credits. Sign in to OpenAI / Codex again on this machine, then reset the brain in this conversation to go back.</div><div class="cmd"><code>codex login</code><span>⧉</span><span>or run it yourself in any terminal</span></div><div class="foot"><span class="btn primary">Reconnect OpenAI / Codex</span></div></div>`
  : `<div class="authcard"><div class="h"><i></i>OpenAI / Codex login unavailable</div><div class="sub">This machine has no OpenAI / Codex login. I do not fall back to an API key on my own, because that bills you.</div><div class="cmd"><code>codex login</code><span>⧉</span><span>or run it yourself in any terminal</span></div><div class="foot"><span class="btn primary">Use NeuraMesh brain here (credits)</span><span class="btn">Reconnect OpenAI / Codex</span><span class="btn">Use an API key instead</span></div></div>`;
const convoHead = `<div class="thead"><span class="scrumb">‹ Home</span><span class="crumb"><span class="proj"><span class="logo"></span>Default</span> › # build</span><span class="ttl">Room Status Check</span><span class="chip c-plan_review">needs you</span><div class="theadact"><span class="settle">Settle</span></div></div>`;
const noticeBarBody = (theme) => `${convoHead}<div class="stack">
  ${msg({ who: 'geo', name: 'geo', at: '05:24 PM', human: true, html: `<p>@rex still there? One line on this room, please.</p>` })}
  ${msg({ who: 'rex', name: 'rex', at: '05:24 PM', html: `<p>@rex cannot run on OpenAI / Codex here. This machine has no OpenAI / Codex login. Sign in to OpenAI / Codex again on this machine, or run this conversation on the NeuraMesh brain, on credits.</p>` })}
  <div class="lbl">Needs you · collapsed (the default)</div>
  ${bnHead('needs', '@rex cannot run here', 'This machine has no OpenAI / Codex login.', false)}
  <div class="lbl">Needs you · expanded</div>
  <div class="bnpanel">${bnHead('needs', '@rex cannot run here', '', true)}
    <div class="bnrow"><div class="bnk">What happened</div><div class="bnv">@rex cannot run on OpenAI / Codex here. This machine has no OpenAI / Codex login. Nothing moved, so this conversation waits.</div></div>
    <div class="bnrow"><div class="bnk">What to do</div><div class="bnv">Sign in to OpenAI / Codex again on this machine, or run this conversation on the NeuraMesh brain, on credits.</div></div>
    <div class="bnrow bnacts">${authCard(false)}</div>
  </div>
  <div class="lbl">Switched · collapsed (a routine moved by itself, or you tapped)</div>
  ${bnHead('switched', '@rex runs on the NeuraMesh brain here', 'This machine has no OpenAI / Codex login.', false)}
  <div class="lbl">Switched · expanded</div>
  <div class="bnpanel switched">${bnHead('switched', '@rex runs on the NeuraMesh brain here', '', true)}
    <div class="bnrow"><div class="bnk">What happened</div><div class="bnv">@rex could not run on OpenAI / Codex here. This machine has no OpenAI / Codex login. This routine continued on the NeuraMesh brain, on credits.</div></div>
    <div class="bnrow"><div class="bnk">What to do</div><div class="bnv">Sign in to OpenAI / Codex again on this machine, then reset the brain in this conversation to go back.</div></div>
    <div class="bnrow bnacts">${authCard(true)}<span class="btn">Reset the brain here</span></div>
  </div>
  <div class="cbox"><div class="cta">Reply in this thread · @ mention · / skill · ↵ send</div>
    <div class="cfoot"><span class="cchip">@</span><span class="cchip"># build</span><span class="cchip brain">◉ Brain <span class="n">1 changed here</span></span><span class="csp"></span><span class="csend">↑</span></div></div>
</div>
<div class="note"><b>F · THE BRAIN NOTICE</b> · docked above the composer, the attention bar’s anatomy one conversation deep. It derives from the newest auth card and the thread’s brain override, so it stands while the condition stands and leaves on its own. The amber rule means nothing moved and the conversation waits on you; the quiet rule records a switch. The server mints a needs-you row from the offer, so the thread pill, Home and the bell count it. Theme: ${theme}.</div>`;

function sheetDoc({ theme, w = 1040, h = 760, body }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>routine hands-off · ${theme}</title>
  ${FONTS}
  <style>
    .sheet { ${tokens(THEMES[theme])} }
    ${CSS}
  </style>
</head>
<body>
<div class="sheet" style="width: ${w}px; height: ${h}px;">
  ${body}
</div>
</body>
</html>
`;
}

const out = {};
out['RoutineThread.dc.html'] = sheetDoc({ theme: 'graphite', body: routineBody('graphite') });
out['RoutineThreadCream.dc.html'] = sheetDoc({ theme: 'cream', body: routineBody('cream oak') });
out['UnitThread.dc.html'] = sheetDoc({ theme: 'graphite', h: 860, body: unitBody('graphite') });
out['UnitThreadCream.dc.html'] = sheetDoc({ theme: 'cream', h: 860, body: unitBody('cream oak') });
out['RoutinePro.dc.html'] = sheetDoc({ theme: 'graphite', h: 900, body: proBody('graphite') });
out['RoutineProCream.dc.html'] = sheetDoc({ theme: 'cream', h: 900, body: proBody('cream oak') });
out['Notice.dc.html'] = sheetDoc({ theme: 'graphite', h: 420, body: noticeBody('graphite') });
out['NoticeCream.dc.html'] = sheetDoc({ theme: 'cream', h: 420, body: noticeBody('cream oak') });
out['StarterHere.dc.html'] = sheetDoc({ theme: 'graphite', h: 900, body: switchBody('graphite', false) });
out['StarterHereAfter.dc.html'] = sheetDoc({ theme: 'graphite', h: 900, body: switchBody('graphite', true) });
out['StarterHereCream.dc.html'] = sheetDoc({ theme: 'cream', h: 900, body: switchBody('cream oak', true) });
out['BrainNotice.dc.html'] = sheetDoc({ theme: 'graphite', h: 1180, body: noticeBarBody('graphite') });
out['BrainNoticeCream.dc.html'] = sheetDoc({ theme: 'cream', h: 1180, body: noticeBarBody('cream oak') });
for (const [f, html] of Object.entries(out)) writeFileSync(f, html);

const A = (file, x, y, w, h, title) => ({ file, x, y, w, h, title });
const canvas = {
  artboards: [
    A('RoutineThread.dc.html', 0, 0, 1040, 760, 'A · The routine’s thread · graphite'),
    A('RoutineThreadCream.dc.html', 1120, 0, 1040, 760, 'A · The routine’s thread · cream oak'),
    A('UnitThread.dc.html', 0, 900, 1040, 860, 'B · The unit’s thread · graphite'),
    A('UnitThreadCream.dc.html', 1120, 900, 1040, 860, 'B · The unit’s thread · cream oak'),
    A('RoutinePro.dc.html', 0, 1900, 1040, 900, 'C · The routine on Pro · graphite'),
    A('RoutineProCream.dc.html', 1120, 1900, 1040, 900, 'C · The routine on Pro · cream oak'),
    A('Notice.dc.html', 0, 2940, 1040, 420, 'D · The notice says why · graphite'),
    A('NoticeCream.dc.html', 1120, 2940, 1040, 420, 'D · The notice says why · cream oak'),
    A('StarterHere.dc.html', 0, 3500, 1040, 900, 'E · Use NeuraMesh brain here · before · graphite'),
    A('StarterHereAfter.dc.html', 1120, 3500, 1040, 900, 'E · Use NeuraMesh brain here · after · graphite'),
    A('StarterHereCream.dc.html', 2240, 3500, 1040, 900, 'E · Use NeuraMesh brain here · after · cream oak'),
    A('BrainNotice.dc.html', 0, 4540, 1040, 1180, 'F · The brain notice · graphite'),
    A('BrainNoticeCream.dc.html', 1120, 4540, 1040, 1180, 'F · The brain notice · cream oak'),
  ],
  annotations: [
    { id: 'note-a', x: 0, y: -150, w: 1000, text: 'A · THE ROUTINE’S THREAD\nA compute notice is not an answer: the host re-asks as the owner once it holds a usable credential (bounded to three, never while a newer run exists). The re-ask is an ordinary human trigger, so the thread wake carries the conversation and the server births the unit approved.' },
    { id: 'note-b', x: 0, y: 760, w: 1000, text: 'B · THE UNIT’S THREAD\nThe plan record says auto-approved · routine. The design round is approved by the routine too (server follow-up, one line in the thread), the build is offered mechanically, and the human reads a run.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote', Object.keys(out).length, 'artboards + canvas.json');
