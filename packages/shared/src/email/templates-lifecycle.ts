// The lifecycle drip — welcome, day 1, day 3. Split out of email/templates.ts.
import {
 b, button, card, esc, h1, h2, layout, linkline, monoList, p, quote, rule, small, stats,
} from './layout';
import { done, type RenderedEmail, type TemplateMeta } from './templates';


export const welcomeMeta: TemplateMeta = {
  kind: 'lifecycle',
  shape: 'The ensemble. A cast, named, one job each',
  claims: [
    ['The six default agents and their roles', 'App.tsx:9272-9278 (+ rex, :9384)'],
    ['Any of them can be renamed before launch', 'App.tsx:9387 setCrewAt'],
    ['Setup is Machine, Keys, Workspace, Team, Launch', 'App.tsx:9354-9364'],
    ['macOS, signed + notarized + stapled', 'docs/11-releases.md:68'],
    ['rex turns a plain sentence into board tasks', 'sync.ts:2521-2528'],
  ],
};

export function renderWelcome(v: { downloadUrl: string; unsubscribeUrl: string }): RenderedEmail {
  const subject = 'Six of them, and they all have names';
  const preheader = 'rex, atlas, patch, scout, iris and bosun. Setup is five screens.';
  return done(subject, preheader, layout({
    preheader,
    unsubscribeUrl: v.unsubscribeUrl,
    footerWhy: 'You created a NeuraMesh account. These onboarding emails stop after your first week.',
    body: [
      h1('Your crew, named'),

      card(
        [
          [b('rex'), 'runs the board and decides who takes what.'],
          [b('atlas'), 'writes the plan.'],
          [b('patch'), 'writes the code.'],
          [b('scout'), 'reviews it, and sends it back when it’s wrong.'],
          [b('iris'), 'designs anything a person will look at.'],
          [b('bosun'), 'holds the release until the checklist clears.'],
        ].map(([name, role]) =>
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:9px;"><tr>` +
          `<td width="66" valign="top" style="font-family:'Geist',-apple-system,sans-serif;font-size:14.5px;padding-top:1px;">${name}</td>` +
          `<td class="nm-body" valign="top" style="font-family:'Geist',-apple-system,sans-serif;font-size:14.5px;line-height:1.55;color:#585249;">${role}</td>` +
          `</tr></table>`).join(''),
      ),

      p('Rename any of them before they start. The roster is yours.'),

      h2('Setup is five screens'),
      p('Connect this Mac, add a model provider, name the workspace, pick the crew, launch. The download is signed and notarized.'),

      button('Download NeuraMesh', v.downloadUrl),
      linkline('Already installed? Open the app and sign in.', v.downloadUrl),

      rule(),
      small(`Then say what you want in ${b('#general')}, in a plain sentence. rex turns it into board tasks and hands them out.`),
    ].join(''),
  }));
}

export const day1Meta: TemplateMeta = {
  kind: 'lifecycle',
  shape: 'The small test. A minor task; the stakes are trust, not scale',
  claims: [
    ['Every task carries an editable definition of done', 'tasks.definition_of_done'],
    ['Submit requires at least one artifact', 'states.ts:278-289'],
    ['Sign-off is human-only on every merge path', 'states.ts:296; approve_ship_plan HUMAN_ONLY'],
  ],
};

export function renderDay1(v: { openUrl: string; unsubscribeUrl: string }): RenderedEmail {
  const subject = 'Give patch something boring';
  const preheader = 'Nobody hands a new mechanic the engine on the first morning.';
  return done(subject, preheader, layout({
    preheader,
    unsubscribeUrl: v.unsubscribeUrl,
    footerWhy: "You signed up for NeuraMesh yesterday and haven't started a task yet.",
    body: [
      h1('Start with something you could do yourself'),
      p('Nobody hands a new mechanic the engine on the first morning. You give them a loose bracket, and you look at the work afterwards.'),

      h2('Try one of these'),
      p(`Open ${b('#general')} and type:`, { tight: true }),
      monoList([
        ['add a --version flag to the CLI'],
        ['the README install steps are stale, fix them'],
        ['write tests for the date parser'],
      ]),

      h2('What comes back'),
      p('rex turns it into a board task with a written definition of done. patch does the work. scout reviews it against that definition and sends it back if it falls short.'),
      p('What reaches you is finished work with its evidence attached, and one decision that is yours. Sign it off and it lands. Leave it, and nothing does.'),

      button('Open NeuraMesh', v.openUrl),
    ].join(''),
  }));
}

export const day3Meta: TemplateMeta = {
  kind: 'lifecycle',
  shape: 'The turn. Something the reader assumed was permanent turns out not to be',
  claims: [
    ['Mining runs after approval, only on tasks that were sent back', 'agents.ts:1580'],
    ['At most 2 lessons per task; the model may return none', 'agents.ts:1592'],
    ['Up to 6 same-channel lessons ride in a prompt', 'agents.ts:1533 (.slice(0,6))'],
    ['The lesson text itself is queryable', 'retro.ts:151 learnedRows'],
  ],
};

/** The SHIPPED variant. Never rendered without a real lesson; see lifecycle.ts. */
export function renderDay3(v: {
  lesson: string; taskNumber: number | null; channel: string; reviewer: string; worker: string;
  statAccepted: number; statReviews: number; statLessons: number; window: string;
  openUrl: string; unsubscribeUrl: string;
}): RenderedEmail {
  const subject = `${v.reviewer} started correcting ${v.worker} before you did`;
  const preheader = v.taskNumber ? `The note you left on #${v.taskNumber} is now a rule in this channel.` : 'Your review notes are becoming rules in this channel.';
  const ref = v.taskNumber ? b(`#${v.taskNumber}`) : 'a task';
  return done(subject, preheader, layout({
    preheader,
    unsubscribeUrl: v.unsubscribeUrl,
    footerWhy: 'You started using NeuraMesh this week.',
    body: [
      h1('The note you left'),
      p(`Earlier this week you sent ${ref} back. You haven't had to say it again.`),
      p(`When that task was finally approved, ${esc(v.reviewer)} distilled the correction into one line and filed it against the task that caused it:`, { tight: true }),

      quote(esc(v.lesson)),

      p(`Up to six of this channel's rules ride along in every task ${esc(v.worker)} picks up here. A contractor you re-brief every morning; a colleague who already knows.`),

      // zero counts drop the whole card. Never "0 tasks accepted".
      (v.statAccepted || v.statReviews || v.statLessons)
        ? [
            h2('Where you are'),
            stats([
              { n: v.statAccepted, label: 'accepted' },
              { n: v.statReviews, label: 'reviews' },
              { n: v.statLessons, label: 'rules learned', green: true },
            ], `${v.window} in #${esc(v.channel)}`),
          ].join('')
        : '',

      button("See what they've learned", v.openUrl),
    ].join(''),
  }));
}
