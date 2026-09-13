# NeuraMesh — App Store submission

Everything needed to submit the iOS app to App Store Connect. Copy each field into the matching
ASC field. Upload the screenshots in `./screenshots/iphone-6.5/`.

All copy on this page follows the house writing rules (CLAUDE.md #11): Simplified Technical
English, no em dashes, no semicolons.

- **Bundle ID:** `app.neuramesh.mobile`
- **ASC App ID:** `6787487455`
- **SKU:** `neuramesh-ios`
- **Version:** `0.2.0` (build auto-incremented by EAS)
- **Primary language:** English (U.S.)

**What changed in 0.2.0.** The app stopped being a companion. You can sign up on the phone, and a
cloud machine comes with your workspace. Every field below changed because of that. Do not reuse
the 0.1.x text.

---

## App name (30 char max)
```
NeuraMesh
```
> Verify availability in ASC. Fallback if taken: `NeuraMesh: AI Dev Team`.

## Subtitle (30 char max)
```
Your AI dev team, from a phone
```

## Promotional text (170 char max, editable without review)
```
Sign up and a cloud machine comes with your workspace. Start work, review plans, approve the code, and open a terminal on your machine. No computer needed.
```

## Description
```
NeuraMesh is the collaboration platform for engineering teams made of humans and AI agents. Version 2 runs from your phone alone: you sign up here, and a cloud machine comes with your workspace.

START THE WORK
Ask your orchestrator for something in plain words. It plans the work, files the tasks, and puts them to the right teammate. Your agents run on your cloud machine, also when your phone is in your pocket.

CLEAR EVERY GATE
Home shows what waits on you: plans to approve, designs to review, tasks ready to accept, and questions from your agents. Each card keeps its buttons, so one tap moves the work.

CODE ON YOUR MACHINE
Start a Code session in a repository, read the plan, and approve each edit and command before it runs. The transcript stays on the machine, and the session says which machine it ran on.

A TERMINAL IN YOUR POCKET
Open a shell on your own cloud machine. Sign in to Claude or GitHub in their own flow, on a machine you own. Your keys stay there.

ROUTINES THAT RUN THEMSELVES
Arm a daily brief or a weekly report. The calendar shows what fires this week, and each run opens its own conversation.

YOUR COMPUTE, CLOUD TRUTH
Your code and your keys never leave machines you own, a cloud machine we provision for you or your own Mac. NeuraMesh holds no repository token and no model key.

A free workspace includes one cloud machine and 500 credits. The Team plan gives each member their own machine.
```

## Keywords (100 char max, comma-separated)
```
AI,agents,code review,developer,engineering,pull request,tasks,team,terminal,automation,devops
```

## What's New (0.2.0 release notes)
```
The phone stopped being a companion.
• Sign up here. A cloud machine comes with your workspace.
• Start sessions, track history, and clear every gate from Home.
• Code sessions on your cloud machine, with plan, approvals and changes.
• A terminal on your machine, for the vendor sign-ins that must happen there.
• Routines and a calendar for the work that repeats.
• Push that lands on the exact screen it is about.
```

## Category
- **Primary:** Developer Tools
- **Secondary:** Productivity

## Age rating
**4+**. No objectionable content.

## URLs
- **Support URL:** `https://neuramesh.app/support`
- **Marketing URL:** `https://neuramesh.app`
- **Privacy Policy URL:** `https://neuramesh.app/privacy` (required before submit)

---

## App Privacy (ASC questionnaire)
Data collected, **linked to identity**, and **not** used for tracking:
- **Contact info.** Email address, for account sign-in through Clerk.
- **User content.** Messages and task data you and your agents create, synced so you can read and
  act on the phone.
- **Identifiers.** User ID, and the device push token that delivers notifications.
- **Diagnostics.** Crash and error logs, if Sentry is enabled.

No advertising, no third-party tracking, and no data sold. The push token is deleted at sign-out.

---

## App Review notes

A reviewer can now serve themselves. Sign-up happens on the web page the app opens in Safari, and
the app returns with a verified session. Give the reviewer a demo account anyway, because a new
workspace provisions a cloud machine and the reviewer does not need to wait for one.

Suggested Review Notes text:
```
NeuraMesh is an engineering collaboration app for teams of humans and AI agents.

SIGN-IN: tap "Start free" or "Sign in". The app opens neuramesh.app in Safari, where you create the account or sign in, and returns to the app with a verified session. The app never asks for a password.

DEMO ACCOUNT: use the credentials in the Sign-In Information fields. That workspace has a team, a board, threads and routines already, so every screen has content.

WHAT THE APP DOES: Home lists the work that waits on a human, and each card acts in place. Code sessions and the terminal run on a cloud machine we provision for the account. The app runs no code itself and holds no source.

The terminal and the Code session need a machine that is awake. On the demo account the machine is already awake.
```

**Sign-In Information (ASC):** provide a demo address and password for a seeded workspace. Create it
with the normal sign-up flow, then seed it, so the reviewer sees the product with content in it.

---

## Screenshots

**Upload set:** `./screenshots/iphone-6.5/`, 1284×2778 portrait, PNG, RGB, no alpha (ASC rejects an
alpha channel). Captured from the real app on an iPhone 14 Plus simulator (the one simulator whose
native size is exactly the 6.5-inch slot) against a seeded workspace, in Cream Oak. Upload in
numeric order:

| File | What it shows |
| --- | --- |
| `01-home.png` | Home: the setup card and the needs-you queue, with each gate's buttons. |
| `02-code.png` | The Code tab: sessions on the cloud machine, by repository. |
| `03-thread.png` | A thread: an agent's work, the unit cards, and what it ran on. |
| `04-routines.png` | Routines: armed, paused and once, with the next run and the run count. |
| `05-compute.png` | Compute: your cloud machine, its state, the credits, and the terminal door. |
| `06-terminal.png` | The terminal: a real shell on the cloud machine, with the key row. |

Re-capture them with `xcrun simctl io <udid> screenshot` on a device named "iPhone 14 Plus", then
flatten the alpha. The old designed frames in `./marketing/` show the 0.1.x companion app and its
retired shell. **Do not upload them for 0.2.0** (App Review 2.3.3: screenshots must show the real
app). Re-render them from the Claude Design canvases with `./render-appstore.mjs` when the design
handoff bundle is at hand, or delete them once a designed 0.2.0 set exists.

**iPad 13-inch slot.** Hold. `supportsTablet` is `false`, so ASC shows no iPad slot, and the frames
in `./marketing/ipad-13/` draw a split view the app does not have.

---

## Build and submit

```bash
# from apps/mobile
eas build --platform ios --profile production      # Xcode 26 image, the two config plugins
eas submit --platform ios --latest                 # ascAppId 6787487455 is in eas.json
```

The production profile builds against `https://api.neuramesh.app` and the production PowerSync
instance. `--auto-submit` uses the `submit.production.ios.ascAppId` in `eas.json` and the App Store
Connect API key held on EAS, so no key travels through this repository.

**0.2.0 build 23 went up on 2026-09-05** (build `cc80e557`, submission `e3049d1a`) and is in
TestFlight. Three things still need a person in App Store Connect, and none of them is the build:
export compliance, the "What to Test" note and a tester group, then the listing above with the six
screenshots.
