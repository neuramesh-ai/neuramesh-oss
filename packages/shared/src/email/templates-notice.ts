// The hosted free notice (source release 2026-09, unit U1b; docs/07 "The hosted write gate").
// One email to every owner of a hosted workspace still on `free`, fourteen days before the
// gate flips (D12: email 2026-09-15, flag 2026-09-29). Transactional: it is a notice about a
// change to the terms of a thing the reader owns, so it reaches them even after an opt-out.
//
// Every sentence is ASD-STE100 (CLAUDE.md #11): active voice, simple tenses, one idea each,
// no em dashes, no semicolons. Split out of templates.ts like templates-account.ts.
import { b, button, esc, h1, h2, kv, card, layout, p, rule, small } from './layout';
import { done, type RenderedEmail, type TemplateMeta } from './templates';

export const hostedFreeNoticeMeta: TemplateMeta = {
  kind: 'transactional',
  shape: 'The notice. One change, dated, and the two doors out of it',
  claims: [
    ['A free hosted workspace refuses writes from the effective date', 'control-api hosted-gate.ts, NM_HOSTED_FREE_GATE'],
    ['Reads, sync, billing, and the export stay open', 'hosted-gate.ts GATE_EXEMPT_ROUTES, every GET passes'],
    ['The export: projects, rooms, threads, tasks, messages, files', 'shared export.ts EXPORT_TABLES, docs/export-format.md'],
    ['Files on a cloud machine are not in the export', 'docs/export-format.md "What is never in the export"'],
    ['Pro is $22 per seat, per month', 'docs/07-billing-and-plans.md'],
    ['Effective 2026-09-29', 'apps/web/src/legal.tsx:18'],
  ],
};

export function renderHostedFreeNotice(v: {
  /** the workspaces this owner holds on free, by name */
  workspaces: string[];
  /** ISO date the gate flips, 2026-09-29 */
  effectiveDate: string;
  proUrl: string;
  termsUrl: string;
  /** the export route, with the owner's own workspace id in it */
  exportPath: string;
}): RenderedEmail {
  const subject = 'A change to your free NeuraMesh workspace';
  const preheader = `On ${v.effectiveDate} your hosted workspace becomes read-only. Your data stays yours.`;
  const one = v.workspaces.length === 1;
  const names = v.workspaces.map((w) => b(esc(w))).join(', ');
  return done(subject, preheader, layout({
    preheader,
    footerWhy: 'You own a hosted NeuraMesh workspace on the free plan. This notice is about a change to it, so it reaches you even after an opt-out from product email.',
    body: [
      h1('Your workspace stays readable. New work moves to Pro.'),
      p(`You own ${one ? 'a NeuraMesh workspace' : `${v.workspaces.length} NeuraMesh workspaces`} on the free plan: ${names}. ${one ? 'It runs' : 'They run'} in our cloud today.`),

      h2(`What changes on ${esc(v.effectiveDate)}`),
      p('Free becomes the desktop app on your Mac. The cloud becomes Pro.'),
      p(`From ${esc(v.effectiveDate)} a hosted free workspace does not accept new writes. You cannot send a message, create a task, or start an agent in it.`),

      h2('What stays'),
      p('Every thread, task, and file stays readable. Sync continues, so the app on your Mac keeps a full copy. We delete nothing.'),

      h2('Your export'),
      p('The workspace owner can export the workspace as one file: projects, rooms, threads, tasks, messages, and files. In the app, open the workspace and choose Export workspace. Files on a cloud machine are not in the export.'),
      card(kv('From a script', esc(v.exportPath)) + kv('Who', 'the workspace owner, signed in')),

      h2('Get Pro'),
      p(`Pro is the cloud around the free app: ${b('$22 per seat, per month')}. Your workspace accepts writes again as soon as the payment completes.`),
      button('Get Pro', v.proUrl),

      rule(),
      small(`The terms page carries the effective date: ${esc(v.termsUrl)}. Reply to this email with a question.`),
    ].join(''),
  }));
}
