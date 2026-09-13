# 06 — Taxonomy: the nouns of NeuraMesh

The canonical definition of every core concept and how they relate. This is the source of truth for terminology across the product, the docs, and agent prompts — when a word here means one thing, it means that everywhere. Cross-references: addressing + protocol in [03](03-protocol-and-memory.md), doctrine in [05](05-engineering-philosophy.md).

---

## 1. The two axes (the mental model)

NeuraMesh is organized as a **two-layer hierarchy** — projects over channels. Almost every confusion about the product dissolves once you hold the two roles apart:

- **Projects are *initiatives*.** A goal with its own board, tasks, repos, and memory — the **work axis**, and the top-level container you navigate by. A project **owns its channels**. One project is active at a time (switch from the top-left); a workspace starts with one **default project** holding the starter channels.
- **Channels are *rooms*.** Where humans and agents talk, and the **access boundary**: registration to a channel is what lets an agent see work, wake to mentions, and read the artifact library. A channel **belongs to exactly one project** (1:N) and is organized by team/function — `#build` (né `#dev`), `#marketing`, `#research` — and since the channel-kinds work a room also carries a `kind` that picks its interface: build rooms run the board, marketing rooms run the growth HQ (docs/design/marketing-channel-2026-07).

The hierarchy is **Workspace → Projects → Channels**. A **task's project is its channel's project** (derived, not chosen): you file work in a channel, and it rolls up to that channel's project. To regroup work, move a channel into another project. The access boundary stays the channel — an agent sees a task because it's registered to the task's *channel*; projects organize, channels gate.

> Why a hierarchy (not M:N)? Conflating "where you talk" with "what you're building" is what we avoid: channels stay communication + ACL, projects stay the unit of work. One project active at a time keeps the surface focused; a channel having exactly one home keeps "which initiative is this?" unambiguous.

```
Workspace ── Members (owner / admin / member)
   │
   ├── Projects  ........ INITIATIVES: the work axis; one active at a time (top-left switcher)
   │     ├── Channels (1:N) ──── the rooms it owns (channels.project_id); the ACL boundary
   │     └── project_repos (M:N) ── the repos it owns
   │
   ├── Repos · Machines · Agents
   │
   └── Tasks ── carry channel_id (room → ACL) + project_id (= the channel's project) + repo_id
```

---

## 2. Concepts

Each row: a one-line definition, its scope and key relations, and **what enforces it** (per [05 §1.3](05-engineering-philosophy.md) — invariants live in the schema/server/types, never in prompt etiquette).

| Concept | One line | Scope / key relations | Enforced by |
|---|---|---|---|
| **Workspace** | The tenant — one team or org. | Top-level; contains everything. The RLS + sync boundary. | `workspaces`; `nm_is_member`; PowerSync rules |
| **Member** (human) | A person in the workspace. | Roles `owner` / `admin` / `member`; `channel_members` grants room access. | `workspace_members`, RLS |
| **Machine** | A developer's computer running the daemon. | Workspace-scoped; owns local agents; outbound-only. | `machines`; [05 §5.4](05-engineering-philosophy.md) |
| **Channel** | A **room**: chat + the **access boundary**. | Belongs to one project (`channels.project_id`, 1:N); `agent_channels` + `channel_members` gate who sees/works in it. | `channels`; channel registration |
| **Project** | An **initiative** — the work axis + top-level container. | **Workspace-scoped; OWNS channels** (1:N) and repos (`project_repos`); one active at a time; one auto **default project per workspace** holds the starter channels. Carries an optional identity — a website + a logo auto-detected **on the user's machine** (from the site's icons or the repo folder; `projects.website` / `logo_url`, a compact data: URL) shown on the switcher, its menus, and Project settings. | `projects`; FSM-independent |
| **Repo** | A git repository. | Workspace-scoped; attaches to projects; a channel's repos = the union of its projects' repos. | `repos`, `project_repos`; the machine's own git/`gh` creds |
| **Task** | A unit of work on the board. | Exactly one **channel** (room → ACL) + one **project** (initiative) + optional repo; the FSM atom. | `tasks`; the server FSM + DB trigger |
| **Artifact** | Validation evidence / a shared file. | Channel-scoped (ACL); optional project/task; orchestrator-curated library. | `artifacts`; channel registration |
| **Agent** | An AI teammate. | Workspace-scoped; **registered to channels** (→ works every project in those channels); local or remote; carries an A2A 1.0 card. **Retirement is soft + human-only** (`agent.retire`): the agent leaves the roster, selection pools, and A2A discovery, but the row and all event/task attribution stay (derived history, docs/13, never orphans); refused while it holds open work; registering the same name rehires it. | `agents.retired_at`, `agent.retire` handler |
| **Role** | What an actor may do. | `orchestrator` / `worker` / `developer` / `reviewer` / `architect` / `designer` / `sales` / `curator`. | FSM role-gates in the Control API |
| **Orchestrator** | The per-channel agent that decomposes work, fans out, and posts digests. | One per channel; resolves the project + repo during requirements; **triages by labeling each task's `kind` and routing to the lightest safe path** — a developer directly for most bugs/small changes, the architect only for plan-worthy work, the designer for visual surfaces ([16-triage.md](16-triage.md)); **staffs the room via human-gated cards** — add an existing workspace agent, or hire a new specialist (`create_agent`, add-before-hire, never silently, never for simple tasks; hires carry a stored specialty `brief` injected into their prompts). | channel settings; hire card confirm |
| **Thread / Message** | A task's conversation; the channel itself gets digests, not detail. | A thread = `messages` with a `task_id`. | thread-per-task |
| **Event** | The append-only spine — task timeline, audit log, and agent inbox. | Every state change is an event. | `events`; append-only trigger |
| **Memory** | Channel summary block + **project brief** + the fact store; hybrid recall. | Scoped by workspace/channel. | pgvector spine (own schema) |
| **Skill / Skill pack** | Reusable named procedures; versioned bundles. | Channel-scoped, promotable to global; curation-gated. | `skills`, `skill_packs` |
| **Board / FSM** | `todo → in_progress → in_review → done → accepted → closed` (+ `blocked`, plan states). | Per task; transitions are server-enforced. | DB trigger + Control API |
| **Definition of Done** | The editable acceptance contract the reviewer gates on. | Per task; frozen once terminal. | `tasks.definition_of_done` |
| **Beat** | An agent's per-phase progress step — the ordered plan it declares on picking up a phase and ticks off live ([17](17-beats.md)). | Per task, one set per phase-attempt (`run_id`); **role-colored** (takes its agent's `--role-*` hue); agent-written only (a human watches); **descriptive, never an FSM gate**. | `beats`, `beat_status`; assignee + phase gated |
| **A2A task vs board task** | The board task is the product entity; each work/review attempt is an A2A task sharing `contextId`. | wire mapping (see [03 §3](03-protocol-and-memory.md)). | A2A 1.0 |

---

## 3. How they relate (cardinalities)

- **Workspace 1 — N Channels**, **1 — N Projects**, **1 — N Repos / Machines / Agents / Members**.
- **Project 1 — N Channels** (`channels.project_id`): a project owns its channels; a channel belongs to exactly one project. The workspace has exactly one **default project** (the catch-all that holds channels not moved elsewhere).
- **Project N — M Repos** via `project_repos` (one `is_primary`). A channel's repos = the union of its projects' repos.
- **Task N — 1 Channel** (the room, the ACL anchor), **N — 1 Project** (the initiative), **N — 1 Repo** (optional). The board for a project = its tasks across all its channels.
- **Agent N — M Channels** via `agent_channels` (the only ACL axis); **N — 1 Machine** for local agents (remote agents have none); **N — 1 Workspace**.
- **Artifact N — 1 Channel** (ACL), optional **N — 1 Project / Task**.

---

## 4. Addressing

The canonical reference scheme (from [03 §1](03-protocol-and-memory.md)); terminology here matches it exactly:

```
human:george        agent:patch          channel/dev
project/landing-page   task:1042         machine:m-georges-mbp
resource/artifact/scr-001
```

---

## 5. Why channels ≠ projects (first principles)

State the constraints, then derive ([05 §2](05-engineering-philosophy.md)):

1. **Two distinct human questions.** "Where do I talk / who can see this?" (a room) and "what initiative is this?" (a deliverable) are different. People navigate by *both*, at different moments.
2. **Access must stay channel-anchored.** Channel registration is the security boundary ([05 §5.4](05-engineering-philosophy.md)): an agent sees a task because it's registered to the task's *channel* — never because of the project. This is why **agents are channel-scoped, not project-scoped**: a `#build` agent works every project whose tasks live in `#build`, and a `#marketing` agent can never receive engineering work. "Cross-project" falls out for free, with no second ACL axis to reason about.
3. **A project groups its rooms.** A project owns the channels its work happens in; its board aggregates the tasks across those channels. To reorganize, move a channel into another project (it takes its agents and history with it). One channel, one project keeps "which initiative is this task?" unambiguous — the answer is just the channel's project.
4. **Zero ceremony is preserved.** Every channel auto-creates one `is_default` project — the per-channel catch-all. A solo founder who never thinks in projects sees exactly the original behavior ("All projects" mode in the top-left switcher). Projects are an axis you *opt into*, not overhead you pay.

The shape (channel = room/ACL, project = initiative/work) matches how the strongest tools converge (teams × projects in Linear; repos × cross-repo projects in GitHub) — but here it's *derived* from the access invariant, not copied.

---

## 6. v1 vs phase 2

**v1 (shipped):** projects are workspace-scoped and **own their channels** (1:N); exactly one project is active at a time, switched from the top-left, scoping the global Board/Tasks/Artifacts + the channel list; one **default project per workspace** holds the starter channels (zero ceremony); create / rename / archive a project and move channels into it (human UI + the orchestrator's `create_project`); a task's project is derived from its channel. **One written deviation:** the Home view (Mission Control, [docs/12](12-mission-control.md) §6) is deliberately **workspace-wide** — a blocked agent or waiting accept in *any* project needs the human, so its counts and queue ignore the active project (cards badge their channel/project instead).

**Phase 2 (deferred):** **create new channels** in-app (today channels are seeded; you move existing ones); project **milestones**; project **dashboards + digest schedules**; a workspace-level **artifact library**; **multi-workspace** switching.
