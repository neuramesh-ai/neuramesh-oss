// Support: contact routes and the FAQ.
import { useState, type ReactNode } from 'react';
import { IconMail } from './brand';
import { Footer } from './shell';
import { DlNav } from './downloads';
import { APP_STORE_URL, FOOTER } from './copy';

// /support — help center: contact email, FAQ, and a request form. The form has no
// server-side intake yet — it composes a structured email in the visitor's own mail
// client, so every request lands at hello@neuramesh.app and the thread stays in
// their inbox. The address is also shown (with copy) for clients without mailto.
export const SUPPORT_EMAIL = 'hello@neuramesh.app';

export const SUPPORT_TOPICS = ['Support question', 'Bug report', 'Feature request', 'Billing', 'Account & sign-in', 'Something else'];

export const SUPPORT_FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'What is neuramesh, in one paragraph?',
    a: <>neuramesh is the fast way to run a company with agents. Your workspace has rooms, one for each kind of work: build, marketing, research, and general. One named crew works in every room. Vetted expert agents on fast models finish real work: marketing drafts, research reports, routines, and pull requests. A different agent checks each result. You approve what goes out.</>,
  },
  {
    q: 'How do I get started?',
    a: <><a href="/downloads">Download the Mac app</a>. It is free, with no account and no limits. The app sets up a small local stack for you. Sign in to Claude, OpenAI, or Gemini on your Mac, and your crew runs on it. <a href="/pro">Get Pro</a> when you want the cloud: a cloud machine for every member, invites, and sync across devices. <a href={APP_STORE_URL ?? '/downloads'}>The iPhone app</a> follows a Pro workspace from the App Store.</>,
  },
  {
    q: 'Does my code or my API keys ever leave my machine?',
    a: <>No. Agents run on machines you own: your Mac, or the cloud machine Pro gives each member. Both are outbound only. There is no inbound port and no server-side access to your code. Your subscriptions and keys sign in on those machines, never on our servers. On Free, nothing leaves your Mac. On Pro, the <strong>neuramesh Starter</strong> model is the one exception: it runs on our metered key, and that key never reaches a machine. Pro sync carries workspace metadata, such as tasks, threads, and agent registrations. It never carries repository contents or credentials. Details in the <a href="/privacy">Privacy Policy</a>.</>,
  },
  {
    q: 'Which AI models can my agents use?',
    a: <>Sign in to your own Claude, OpenAI, or Gemini subscription on a machine you own, or add an API key. Pick a pack, or set one model per role. A Pro workspace also starts on the <strong>neuramesh Starter</strong> model, a fast model on our metered key. neuramesh never marks up tokens. See the <a href="/model-benchmarks">model benchmarks</a> for how they compare per role.</>,
  },
  {
    q: 'What is a credit?',
    a: <>Credits are part of Pro. One credit is one cent. Credits pay for two things: the neuramesh Starter model, at the vendor list price per token, and your cloud machine while it works, at one credit per ten active minutes. A machine on standby costs nothing. Pro grants 1,500 credits per seat each month. Grants reset each month. You can also buy a pack, from $5 for 500 credits. Purchased credits never expire. Free has no credits: your own subscriptions and keys do the work.</>,
  },
  {
    q: 'Can an agent merge code without my approval?',
    a: <>No, by construction. Work ships as a pull request. A different agent reviews it against CI and the task definition of done. The merge happens only when a human presses <strong>Accept</strong>. Nothing reaches your main branch by direct commit. The same gate holds for a post or a plan: the crew drafts, you approve.</>,
  },
  {
    q: 'What is an expert, and how do I hire one?',
    a: <>An expert is a tested agent with its own skills and playbook for one kind of work: a website audit, a launch plan, an email sequence, a code review. Hire one with one command. It runs on a machine you own and reports in your room. Every expert ships with its turnaround and its bench score.</>,
  },
  {
    q: 'Can I work with my team?',
    a: <>Yes, on Pro. Invite people into the rooms. Every member gets a cloud machine, and the team shares them. Everyone sees the same threads, the same evidence, and the same gates. A room policy decides which agents can see it, and the server enforces it. Free is one person on one Mac.</>,
  },
  {
    q: 'What does the iPhone app do, and how do I sign in?',
    a: <>The iPhone app is the companion to a Pro workspace. It sends you a push the moment a gate needs a human: a plan to review, a draft to approve, a pull request to accept. You read the thread, see the evidence, reply, and tap Accept from anywhere. It never runs agents and never touches your source. Sign in with the same account. The app hands the sign-in to your browser and returns signed in. <a href={APP_STORE_URL ?? '/downloads'}>Get it on the App Store</a>.</>,
  },
  {
    q: 'How much does it cost?',
    a: <><strong>Free</strong> is the desktop app on your Mac, with no account and no time limit: every room, agent, and task on your machine, your subscriptions and keys, and no limits on projects, agents, or tasks. The app sets up a small local stack for you. <strong>Pro</strong> is $22 per seat per month: the hosted cloud around it, with a cloud machine for every member, invites, seats, sync across devices, the browser app, the phone, and connectors that publish. Bring your own Claude, OpenAI, or Gemini subscriptions. neuramesh never marks up tokens.</>,
  },
  {
    q: 'Can I read the source?',
    a: <>Yes. The source is available under the Elastic License 2.0 at <a href={FOOTER.source.url}>github.com/neuramesh-ai/neuramesh-oss</a>. You can read it, run it, and change it. You cannot offer neuramesh itself to others as a hosted service. The neuramesh name and mark stay ours.</>,
  },
  {
    q: 'How should I report a bug?',
    a: <>Use the form below with the topic set to Bug report, or email us. The fastest reports include what you did, what you expected, what happened instead, and your app version (the neuramesh menu, then About). Screenshots help. A human reads every message.</>,
  },
];

export function SupportPage({ onBack }: { onBack: () => void }) {
  const [topic, setTopic] = useState(SUPPORT_TOPICS[0]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(SUPPORT_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };
  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const subject = `neuramesh: ${topic}`;
    const body = name.trim() ? `${message}\n\n${name.trim()}` : message;
    location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };
  return (
    <>
      <DlNav onBack={onBack} />
      <section className="legalpage">
        <div className="wrap legalwrap">
          <header className="legalhead">
            <div className="seyebrow left">Support</div>
            <h1>How can we help?</h1>
            <p className="legaldesc">Questions, bug reports, and feature requests. A human reads every message, usually within a day. Check the FAQ, send the form, or email us.</p>
            <div className="supcontact">
              <span className="supcontactico"><IconMail /></span>
              <div className="supcontactbody">
                <b>Email us anytime</b>
                <a className="supmail" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              </div>
              <button className="btn supcopy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy address'}</button>
            </div>
          </header>

          <div className="supsec">
            <h2>Frequently asked questions</h2>
            <div className="faqlist">
              {SUPPORT_FAQ.map((f) => (
                <details className="faqitem" key={f.q}>
                  <summary>{f.q}<span className="faqcaret" aria-hidden>+</span></summary>
                  <div className="faqbody">{f.a}</div>
                </details>
              ))}
            </div>
          </div>

          <div className="supsec">
            <h2>Send us a request</h2>
            <p className="supformsub">Send opens your email app with the request addressed to {SUPPORT_EMAIL}, so the thread stays in your inbox too.</p>
            <form className="supform" onSubmit={submit}>
              <div className="supformrow">
                <div className="fld">
                  <label htmlFor="sup-topic">Topic</label>
                  <select id="sup-topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
                    {SUPPORT_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="fld">
                  <label htmlFor="sup-name">Your name <span className="optlabel">optional</span></label>
                  <input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
                </div>
              </div>
              <div className="fld">
                <label htmlFor="sup-msg">What's going on?</label>
                <textarea id="sup-msg" required value={message} onChange={(e) => setMessage(e.target.value)} rows={7} placeholder="Tell us what you need. For bugs: what you did, what you expected, what happened instead, and your app version." />
              </div>
              <div className="supformfoot">
                <button className="btn primary" type="submit">Send request →</button>
                {sent && <span className="supsent">✓ Your email app opened. Nothing happened? Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></span>}
              </div>
            </form>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
