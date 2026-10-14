import { agentInChannel } from '@neuramesh/shared';
import { AgentAvatar } from '../components/AgentAvatar';
import type { AgentRow } from '../bridge/rows-crew';

/**
 * The room's "you can just ask" cap, sitting at the top of a composer box.
 *
 * Mentions are how work starts here and nothing on screen said so — the placeholder's "@ mention"
 * is a syntax note, not an invitation. It names a ROOM'S orchestrator (never a hardcoded "rex":
 * the name is per workspace, and a room may have been staffed with someone else), and the name is
 * a button, so reading the hint and acting on it are one gesture.
 */
export function ComposerHint({ lead, onInsert }: { lead: AgentRow; onInsert: (name: string) => void }) {
  return (
    <div className="chint">
      <AgentAvatar name={lead.name} emoji={lead.emoji} size={15} radius={4} role={lead.role} />
      {/* docs/34 §14: one composer, one consequence — the orchestrator triages every send and
          decides what becomes a task, so the hint no longer branches on a mode. */}
      <span>
        Mention{' '}
        <button type="button" className="chintat" onClick={() => onInsert(lead.name)}>@{lead.name}</button>{' '}
        or another teammate whenever you want their help.
      </span>
    </div>
  );
}

/** An IPC failure as a human sentence — the Electron wrapper prefix is noise, not information. */
/** the orchestrator a given room would route through — the one this hint should introduce */
export function leadFor(agents: AgentRow[], channelId: string | null | undefined): AgentRow | null {
  if (!channelId) return null;
  return agents.find((a) => a.role === 'orchestrator' && !a.retired_at && agentInChannel(a.channel_ids, channelId)) ?? null;
}

