// THE SHELF IN THE CONVERSATION (2026-09-19): the marketer's skill said "read the room's brand docs"
// and the chat registry had no tool that could. The same reads as the orchestrator's, one
// implementation (host/grounding.ts), split from chattools.ts at the size gate.
import { listLibrary, readLibraryDoc, type Grounding } from './grounding';
import { angleCard, angleGate, connectedPlatforms, type AngleInput } from './ugcflow';
import type { ChatToolCtx } from './chattools';

export function libraryChatTools(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'ch' | 'log' | 'libraryDocs'>, grounding: Grounding) {
  const { z, tool, text, ch, log, libraryDocs } = t;
  return [
    tool(
      'list_library',
      'The documents in a room\'s library — brand guidelines, business profile, market research, strategy notes, reports the team has produced. Check this BEFORE answering anything about the product, its market or its voice, and before you draft.',
      { scope: z.enum(['room', 'project', 'workspace']).optional().describe("'room' (default) = this room's shelf. 'project' = every room in this project. 'workspace' = everything the team keeps.") },
      async (i) => {
        const scope = (i.scope as 'room' | 'project' | 'workspace' | undefined) ?? 'room';
        log({ kind: 'tool', phase: 'call', summary: `list_library ${scope}` });
        return text(await listLibrary(libraryDocs, ch.id, scope));
      },
    ),
    tool(
      'read_library_doc',
      'Read a document from a room\'s library by name (the names come from list_library). The team\'s own record: it outranks anything on the open web about this product. Read the brand docs before you draft.',
      { name: z.string().min(1).describe('the exact document name from list_library, e.g. business-profile.md'), scope: z.enum(['room', 'project', 'workspace']).optional().describe('the scope you found the name in') },
      async (i) => {
        const scope = (i.scope as 'room' | 'project' | 'workspace' | undefined) ?? 'room';
        log({ kind: 'tool', phase: 'call', summary: `read_library_doc ${String(i.name)}` });
        return text(await readLibraryDoc(libraryDocs, ch.id, String(i.name), scope, grounding));
      },
    ),
  ];
}

/** THE UGC PLAYBOOK's second step in the conversation registry (host/ugcflow.ts): the angle card */
export function ugcChatTools(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'threadId' | 'log' | 'db' | 'post'>, grounding: Grounding) {
  const { z, tool, text, agent, ch, threadId, log, db, post } = t;
  return [
    tool(
      'propose_angles',
      'THE UGC PLAYBOOK, step two, after the research: post the ANGLE CARD in this conversation — two to five angles for the creator videos, each resting on a fact from the brand docs you just read, with "type your own" as the alternate and the room\'s platforms as chips (connected accounts come picked). Then STOP: the human\'s pick wakes you, and only then draft_posts, one video post per picked platform in the chosen angle. A creator script drafted before this card is answered is refused.',
      {
        product: z.string().min(1).max(80).describe('the product name as the brand docs say it'),
        angles: z.array(z.object({
          title: z.string().min(1).max(60).describe('the angle, as a creator would pitch it'),
          why: z.string().min(1).max(200).describe('the product fact from the shelf this angle rests on'),
        })).min(2).max(5),
      },
      async (i) => {
        const input = i as AngleInput;
        const gate = await angleGate(db, ch.id, grounding, input);
        if (gate) return text(gate);
        const conns = await connectedPlatforms(db, ch.id);
        const posted = await post('/v1/messages', { kind: 'agent', id: agent.id }, { workspace: ch.workspace_id, channel: ch.id, threadId, body: angleCard(input, conns) }).catch(() => null);
        if (!posted?.ok) return text('the angle card could not be posted — say so plainly rather than listing the angles in your reply');
        log({ kind: 'tool', phase: 'call', summary: `propose_angles — ${input.angles.length} angles, platforms ${conns.join(', ') || 'none connected'}` });
        return text(`Angle card posted with ${input.angles.length} angles. STOP here and say one line: the human picks on the card. Their pick wakes you; then call draft_posts with one video post per picked platform in that angle.`);
      },
    ),
  ];
}
