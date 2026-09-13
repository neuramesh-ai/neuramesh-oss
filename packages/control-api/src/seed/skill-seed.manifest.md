# Bundled skill packs — manifest

Generated 2026-07-06 by `pnpm --filter @neuramesh/control-api gen:skill-seed`.
This is the local log of third-party skills NeuraMesh ships as defaults — diff it
when upgrading a pack to see what was added / removed / curated. Bodies capped at
32,000 chars. Licenses + copyright: see /NOTICE.

## gstack — bundled@11de390be1be

Source: https://github.com/garrytan/gstack (main)

**Included (14):**
- `cso` — Chief Security Officer mode. (gstack)
- `design-review` — Designer's eye QA: finds visual inconsistency, spacing issues, hierarchy problems, AI slop patterns, and slow interactions — then fixes them. (gstack)
- `document-generate` — Generate missing documentation from scratch for a feature, module, or entire project. (gstack)
- `document-release` — Post-ship documentation update. (gstack)
- `health` — Code quality dashboard. (gstack)
- `investigate` — Systematic debugging with root cause investigation. (gstack)
- `plan-ceo-review` — CEO/founder-mode plan review. (gstack)
- `plan-design-review` — Designer's eye plan review — interactive, like CEO and Eng review. (gstack)
- `plan-devex-review` — Interactive developer experience plan review. (gstack)
- `plan-eng-review` — Eng manager-mode plan review. (gstack)
- `qa` — Systematically QA test a web application and fix bugs found. (gstack)
- `qa-only` — Report-only QA testing. (gstack)
- `retro` — Weekly engineering retrospective. (gstack)
- `review` — Pre-landing PR review. (gstack)

**Excluded (45, not relevant to NeuraMesh agents):**
- `autoplan`
- `benchmark`
- `benchmark-models`
- `browse`
- `canary`
- `careful`
- `codex`
- `context-restore`
- `context-save`
- `design-consultation`
- `design-html`
- `design-shotgun`
- `devex-review`
- `diagram`
- `freeze`
- `gstack`
- `gstack-openclaw-ceo-review`
- `gstack-openclaw-investigate`
- `gstack-openclaw-office-hours`
- `gstack-openclaw-retro`
- `gstack-upgrade`
- `guard`
- `hackernews-frontpage`
- `ios-clean`
- `ios-design-review`
- `ios-fix`
- `ios-qa`
- `ios-sync`
- `land-and-deploy`
- `landing-report`
- `learn`
- `make-pdf`
- `office-hours`
- `open-gstack-browser`
- `pair-agent`
- `plan-tune`
- `scrape`
- `setup-browser-cookies`
- `setup-deploy`
- `setup-gbrain`
- `ship`
- `skillify`
- `spec`
- `sync-gbrain`
- `unfreeze`

## agent-skills — bundled@076af17226cf

Source: https://github.com/addyosmani/agent-skills (main)

**Included (24):**
- `api-and-interface-design` — Guides stable API and interface design. Use when designing APIs, module boundaries, or any public interface. Use when creating REST or GraphQL endpoints, defining type contracts between modules, or establishing boundaries between frontend and backend.
- `browser-testing-with-devtools` — Tests in real browsers via Chrome DevTools MCP. Use when building or debugging anything that runs in a browser. Use when you need to inspect the DOM, capture console errors, analyze network requests, profile performance, or verify visual output with real runtime data. Requires the chrome-devtools MC
- `ci-cd-and-automation` — Automates CI/CD pipeline setup. Use when setting up or modifying build and deployment pipelines. Use when you need to automate quality gates, configure test runners in CI, or establish deployment strategies.
- `code-review-and-quality` — Conducts multi-axis code review. Use before merging any change. Use when reviewing code written by yourself, another agent, or a human. Use when you need to assess code quality across multiple dimensions before it enters the main branch.
- `code-simplification` — Simplifies code for clarity. Use when refactoring code for clarity without changing behavior. Use when code works but is harder to read, maintain, or extend than it should be. Use when reviewing code that has accumulated unnecessary complexity.
- `context-engineering` — Optimizes agent context setup. Use when starting a new session, when agent output quality degrades, when switching between tasks, or when you need to configure rules files and context for a project.
- `debugging-and-error-recovery` — Guides systematic root-cause debugging. Use when tests fail, builds break, behavior doesn't match expectations, or you encounter any unexpected error. Use when you need a systematic approach to finding and fixing the root cause rather than guessing.
- `deprecation-and-migration` — Manages deprecation and migration. Use when removing old systems, APIs, or features. Use when migrating users from one implementation to another. Use when deciding whether to maintain or sunset existing code.
- `documentation-and-adrs` — Records decisions and documentation. Use when making architectural decisions, changing public APIs, shipping features, or when you need to record context that future engineers and agents will need to understand the codebase.
- `doubt-driven-development` — Subjects every non-trivial decision to a fresh-context adversarial review before it stands. Use when correctness matters more than speed, when working in unfamiliar code, when stakes are high (production, security-sensitive logic, irreversible operations), or any time a confident output would be che
- `frontend-ui-engineering` — Builds production-quality UIs. Use when building or modifying user-facing interfaces. Use when creating components, implementing layouts, managing state, or when the output needs to look and feel production-quality rather than AI-generated.
- `git-workflow-and-versioning` — Structures git workflow practices. Use when making any code change. Use when committing, branching, resolving conflicts, or when you need to organize work across multiple parallel streams. Use when cutting a release, choosing a semantic version bump, tagging, or writing a changelog.
- `idea-refine` — Refines raw ideas into sharp, actionable concepts through structured divergent and convergent thinking. Use when an idea is still vague, when you need to stress-test assumptions before committing to a plan, or when you want to expand options before converging on one. Triggers on "ideate", "refine th
- `incremental-implementation` — Delivers changes incrementally. Use when implementing any feature or change that touches more than one file. Use when you're about to write a large amount of code at once, or when a task feels too big to land in one step.
- `interview-me` — Extracts what the user actually wants instead of what they think they should want. Achieves this through one-question-at-a-time interview until ~95% confidence about the underlying intent. Use when an ask is underspecified ("build me X" without "for whom" or "why now"), when the user explicitly invo
- `observability-and-instrumentation` — Instruments code so production behavior is visible and diagnosable. Use when adding logging, metrics, tracing, or alerting. Use when shipping any feature that runs in production and you need evidence it works. Use when production issues are reported but you can't tell what happened from the availabl
- `performance-optimization` — Optimizes application performance. Use when performance requirements exist, when you suspect performance regressions, or when Core Web Vitals or load times need improvement. Use when profiling reveals bottlenecks that need fixing.
- `planning-and-task-breakdown` — Breaks work into ordered tasks. Use when you have a spec or clear requirements and need to break work into implementable tasks. Use when a task feels too large to start, when you need to estimate scope, or when parallel work is possible.
- `security-and-hardening` — Hardens code against vulnerabilities. Use when handling user input, authentication, data storage, or external integrations. Use when building any feature that accepts untrusted data, manages user sessions, or interacts with third-party services.
- `shipping-and-launch` — Prepares production launches. Use when preparing to deploy to production. Use when you need a pre-launch checklist, when setting up monitoring, when planning a staged rollout, or when you need a rollback strategy.
- `source-driven-development` — Grounds every implementation decision in official documentation. Use when you want authoritative, source-cited code free from outdated patterns. Use when building with any framework or library where correctness matters.
- `spec-driven-development` — Creates specs before coding. Use when starting a new project, feature, or significant change and no specification exists yet. Use when requirements are unclear, ambiguous, or only exist as a vague idea.
- `test-driven-development` — Drives development with tests. Use when implementing any logic, fixing any bug, or changing any behavior. Use when you need to prove that code works, when a bug report arrives, or when you're about to modify existing functionality.
- `using-agent-skills` — Discovers and invokes agent skills. Use when starting a session or when you need to discover which skill applies to the current task. This is the meta-skill that governs how all other skills are discovered and invoked.

## design-craft — bundled@1274a0584c4f

Source: https://github.com/emilkowalski/skills (main)

**Included (3):**
- `animation-vocabulary` — Reverse-lookup glossary that turns a vague description of a web animation or motion effect into its exact term ("the bouncy thing when a popover opens" → Pop in; "the iOS rubber-band scroll" → Rubber-banding). Use when the user asks "what's it called when…", or describes a motion effect without know
- `emil-design-eng` — This skill encodes Emil Kowalski's philosophy on UI polish, component design, animation decisions, and the invisible details that make software feel great.
- `review-animations` — Reviews animation and motion code against a high craft bar derived from Emil Kowalski's design engineering philosophy. Default to flagging; approval is earned.
