// Terms + Privacy — long-form copy, no product logic.

import { Footer } from './shell';

import { DlNav } from './downloads';

// /terms — Terms of Service, neuramesh-grounded boilerplate covering AI agent
// orchestration, multi-agent workspaces, task routing, and developer tooling.
export function TermsPage({ onBack }: { onBack: () => void }) {
  return (
    <>
      <DlNav onBack={onBack} />
      <section className="legalpage">
        <div className="wrap legalwrap">
          <header className="legalhead">
            <div className="seyebrow left">Legal</div>
            <h1>Terms of Service</h1>
            <div className="legaleff">Effective 2026-09-29</div>
            <p className="legaldesc">These Terms govern your access to neuramesh, the platform for teams of people and AI agents. When you use neuramesh or create an account, you agree to these Terms.</p>
          </header>
          <div className="legalbody">
            <div className="legalsec">
              <h2>1. What neuramesh Is</h2>
              <p>neuramesh is a developer platform for named teams of role-specialized AI agents (architects, developers, reviewers) that plan, build, review, and ship real pull requests behind a <strong>Definition of Done</strong>. Agents operate within Workspaces, Projects, and Channels through a structured loop: plan → fan out → execute → validate → review → accept. Each task follows a tracked lifecycle (<em>todo → in_progress → in_review → done → accepted → closed</em>). Acceptance is always a human action.</p>
            </div>
            <div className="legalsec">
              <h2>2. Accounts and Workspaces</h2>
              <p>The Free desktop app needs no account. Pro needs an account with a verified email. You are responsible for all activity under your account and for keeping your credentials confidential. Each account carries one Workspace, the top-level container for your Projects, Channels, and agent registrations.</p>
            </div>
            <div className="legalsec">
              <h2>3. AI Agents and Task Routing</h2>
              <p>neuramesh provides infrastructure for orchestrating AI agents using the A2A 1.0 protocol for agent discovery, task routing, and context handoff across multi-agent workspaces. Agents register to channels; they see tasks via their channel, not their project directly.</p>
              <p>You are responsible for the behavior of agents you register. neuramesh does not control or guarantee the accuracy, safety, or fitness of agent outputs. For code tasks, acceptance triggers a squash merge of the agent's pull request to its base branch. No code reaches your main branch without your explicit approval.</p>
            </div>
            <div className="legalsec">
              <h2>4. Code, Keys, and Local-First Architecture</h2>
              <p>On the <strong>Free plan</strong>, your source code, repository contents, and LLM API keys never leave your Mac. The app runs the whole product on your machine, and nothing transits neuramesh servers. Keys are stored in your system keychain.</p>
              <p>The <strong>Pro plan</strong> adds the hosted cloud: workspace sync, cloud machines, and cross-device access. Even then, repository contents and API credentials remain on machines you own. neuramesh syncs workspace metadata (task state, channel history, agent registrations), not your code.</p>
            </div>
            <div className="legalsec">
              <h2>5. Acceptable Use</h2>
              <p>You may use neuramesh only for lawful purposes in compliance with all applicable laws. You must not:</p>
              <ul>
                <li>Register agents designed to deceive, manipulate, or harm individuals</li>
                <li>Automate unauthorized access, scraping, or attacks against third-party systems</li>
                <li>Generate or distribute malware or malicious code through the platform</li>
                <li>Violate the terms of any AI provider whose models you connect via BYOK</li>
                <li>Circumvent platform usage limits or security controls</li>
              </ul>
            </div>
            <div className="legalsec">
              <h2>6. Intellectual Property</h2>
              <p>neuramesh retains all rights to the platform, software, brand, and documentation. You retain all rights to code, artifacts, and work products generated through your use of the platform. A2A agent cards you publish to the Marketplace grant neuramesh a non-exclusive, royalty-free license to list, describe, and make your agent available for installation into workspaces where it is invited.</p>
              <p>The neuramesh source is available under the Elastic License 2.0. That license lets you use, copy, change, and run the software. It does not let you provide neuramesh to others as a hosted or managed service. The neuramesh name and marks are not licensed.</p>
            </div>
            <div className="legalsec">
              <h2>7. Marketplace and Third-Party Agents</h2>
              <p>The neuramesh Marketplace lists vetted AI agents available over A2A, published by third parties. We review agents before listing but do not warrant their accuracy, fitness, or security. You assume responsibility for the third-party agents you add to your workspace and for the tasks you route to them.</p>
            </div>
            <div className="legalsec">
              <h2>8. Subscriptions and Billing</h2>
              <p>The Free plan is the desktop app on your Mac: free, with no account and no time limit. The Pro plan is billed per seat, per month, on the terms shown at checkout. If you cancel, you keep access through the end of the paid period. A hosted workspace without a Pro subscription keeps read access to its data and can export it. We may change pricing with 30 days notice to existing subscribers.</p>
            </div>
            <div className="legalsec">
              <h2>9. Disclaimer of Warranties</h2>
              <p>neuramesh is provided <em>"as is"</em> without warranties of any kind, express or implied. We do not warrant that the platform will be uninterrupted or error-free, or that AI agent outputs will be accurate, complete, or suitable for your intended use.</p>
            </div>
            <div className="legalsec">
              <h2>10. Limitation of Liability</h2>
              <p>To the fullest extent permitted by law, neuramesh and its affiliates will not be liable for indirect, incidental, special, consequential, or punitive damages arising from your use of the platform, even if advised of the possibility of such damages. Our aggregate liability is limited to the greater of amounts you paid us in the 12 months before the claim or $100.</p>
            </div>
            <div className="legalsec">
              <h2>11. Changes to These Terms</h2>
              <p>We may update these Terms from time to time. We will notify you by email or via in-app notice at least 14 days before material changes take effect. Continued use of neuramesh after that date constitutes acceptance of the revised Terms.</p>
            </div>
            <div className="legalsec">
              <h2>12. Governing Law</h2>
              <p>These Terms are governed by the laws of the State of Delaware, without regard to conflict-of-law principles.</p>
            </div>
            <div className="legalsec">
              <h2>13. Contact</h2>
              <p>Questions about these Terms? Email <a href="mailto:legal@neuramesh.app">legal@neuramesh.app</a>.</p>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

// /privacy — Privacy Policy, local-first architecture grounded and honest about
// what we collect (account metadata) vs. what stays on your machine (code + keys).
export function PrivacyPage({ onBack }: { onBack: () => void }) {
  return (
    <>
      <DlNav onBack={onBack} />
      <section className="legalpage">
        <div className="wrap legalwrap">
          <header className="legalhead">
            <div className="seyebrow left">Legal</div>
            <h1>Privacy Policy</h1>
            <div className="legaleff">Effective 2026-09-29</div>
            <p className="legaldesc">neuramesh, Inc. ("neuramesh," "we," "our," or "us") is committed to protecting your privacy. This Policy explains what we collect, how we use it, and your rights.</p>
          </header>
          <div className="legalbody">
            <div className="legalsec">
              <h2>1. Local-First by Design</h2>
              <p>On the <strong>Free plan</strong>, your code, LLM API keys, agent outputs, and task artifacts never leave your Mac. The app runs the whole product on your machine, and nothing reaches neuramesh servers. This Policy describes the data we receive for accounts and the Pro cloud.</p>
            </div>
            <div className="legalsec">
              <h2>2. Information We Collect</h2>
              <p>When you create a neuramesh account, we collect:</p>
              <ul>
                <li>Name and email address, via Clerk (our authentication provider)</li>
                <li>Account metadata: plan type, workspace and project names, channel slugs, and agent registrations</li>
                <li>Usage metrics: task counts, agent activity aggregates, and feature adoption signals (Pro plan)</li>
                <li>Anonymous page events on this marketing site (event names like "page viewed" or "download clicked", with no cookies, no cross-visit identity, and no content, served first-party), plus aggregate visitor counts and performance vitals via Vercel Web Analytics (cookieless, daily-rotating anonymous hash)</li>
                <li>Error logs and diagnostic data sufficient to identify and fix platform issues</li>
              </ul>
            </div>
            <div className="legalsec">
              <h2>3. Information We Do Not Collect</h2>
              <p>We do not collect, transmit, or store:</p>
              <ul>
                <li>Your source code or any repository contents</li>
                <li>Your LLM API keys or credentials (stored in your system keychain, never transmitted)</li>
                <li>The content of messages in your channels or workspaces</li>
                <li>Agent-generated artifacts, diffs, or pull request contents</li>
              </ul>
            </div>
            <div className="legalsec">
              <h2>4. How We Use Your Data</h2>
              <p>We use the data we collect to:</p>
              <ul>
                <li>Provide, operate, and improve the neuramesh platform</li>
                <li>Authenticate you and manage your workspace and agent registrations</li>
                <li>Communicate about your account, plan changes, and product updates</li>
                <li>Monitor platform health, diagnose bugs, and prevent abuse</li>
                <li>Enforce our Terms of Service</li>
              </ul>
            </div>
            <div className="legalsec">
              <h2>5. Data Sharing</h2>
              <p>We do not sell your personal information. We share data only with:</p>
              <ul>
                <li><strong>Clerk</strong> (authentication), <strong>Supabase</strong> (database and sync), and <strong>Vercel</strong> (web hosting), our infrastructure providers, each bound by data processing agreements</li>
                <li>Law enforcement or legal process where required by law and narrowly necessary</li>
                <li>Successor entities in the event of a merger or acquisition, with advance notice to you</li>
              </ul>
            </div>
            <div className="legalsec">
              <h2>6. Retention</h2>
              <p>We retain account and usage data for as long as your account is active, and for up to 24 months after account closure for audit and abuse-prevention purposes. You may request deletion sooner. See Your Rights below.</p>
            </div>
            <div className="legalsec">
              <h2>7. Your Rights</h2>
              <p>Depending on your jurisdiction, you may have rights to access, correct, delete, or export the personal data we hold. To exercise any right, email <a href="mailto:privacy@neuramesh.app">privacy@neuramesh.app</a>. We respond to verified requests within 30 days.</p>
            </div>
            <div className="legalsec">
              <h2>8. Security</h2>
              <p>We apply industry-standard security practices: TLS 1.3 for data in transit, AES-256 encryption at rest, and least-privilege access controls. No system is perfectly secure. If you discover a vulnerability, please disclose it responsibly to <a href="mailto:privacy@neuramesh.app">privacy@neuramesh.app</a>.</p>
            </div>
            <div className="legalsec">
              <h2>9. Third-Party Agents and the Marketplace</h2>
              <p>Third-party agents installed from the neuramesh Marketplace operate under their own publisher's privacy policies. neuramesh does not receive data processed by third-party agents running in your workspace, and we do not control their privacy practices.</p>
            </div>
            <div className="legalsec">
              <h2>10. Children's Privacy</h2>
              <p>neuramesh is intended for users 16 and older. We do not knowingly collect personal information from children under 16. If you believe we have done so inadvertently, please contact us and we will delete it promptly.</p>
            </div>
            <div className="legalsec">
              <h2>11. Changes to This Policy</h2>
              <p>We will notify you of material changes via email or in-app notice at least 14 days in advance. The current effective date always appears at the top of this page.</p>
            </div>
            <div className="legalsec">
              <h2>12. Contact</h2>
              <p>Privacy questions or data requests: <a href="mailto:privacy@neuramesh.app">privacy@neuramesh.app</a></p>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
