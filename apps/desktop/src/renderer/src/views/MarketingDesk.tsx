// THE DESK (docs/design/marketing-os-desk-2026-09, 2026-09-17): one tile per project, three lines —
// identity with the score dial or the door the project still needs, the facts, the connector marks.
// A project picked lays the one tile flat as a line. The three honest states and the click are the
// cards' (docs/design/marketing-os-2026-08 scene 01: finish setup › the setup task, no baseline › the
// audit ask, scored › scope to the project); only the anatomy is the round's.
import { MARKETING_SETUP_FLOW, PLAYBOOKS, playbookAsk, setupProgress, setupProgressLabel } from '@neuramesh/shared';
import { ProjLogo } from '../components/AgentAvatar';
import { ConnStrip, Dial, whenShort, type RoomPlaybookState } from './mkosbits';
import type { ConnectorRow } from '../bridge/rows-content';
import type { ChannelRow } from '../bridge/rows-rooms';
import type { TaskAllRow, WorkspaceProjectRow } from '../bridge/rows-board';

export interface DeskCard {
  p: WorkspaceProjectRow;
  room: ChannelRow;
  /** the room's per-playbook state (score, age, armed cadence), absent before the first read */
  per: Map<string, RoomPlaybookState> | undefined;
  setupTask: TaskAllRow | null;
  conns: ConnectorRow[];
}

const AUDIT = PLAYBOOKS.find((x) => x.id === 'audit')!;

export function MarketingDesk({ cards, line, onOpenTask, onAsk, onScope }: {
  cards: DeskCard[];
  /** a project is picked: the desk is one line, not a strip */
  line: boolean;
  onOpenTask: (taskId: string) => void;
  onAsk: (channelId: string, text: string) => void;
  onScope: (projectId: string) => void;
}) {
  return (
    <div className={line ? 'mkdeskline' : 'mkdesk'}>
      {cards.map(({ p, room, per, setupTask, conns }) => {
        const progress = setupProgress(MARKETING_SETUP_FLOW, room.marketing ?? null);
        const audit = per?.get('audit');
        const armed = per ? [...per.values()].filter((s) => s.armed).length : 0;
        const cadences = `${armed} cadence${armed === 1 ? '' : 's'} armed`;
        const scored = progress.complete && audit?.lastScore != null;
        const facts = !progress.complete
          ? `not set up · ${setupProgressLabel(MARKETING_SETUP_FLOW, progress)}`
          : scored
            ? `${cadences}${audit?.lastAt ? ` · audited ${whenShort(audit.lastAt)}` : ''}`
            : `no baseline yet · docs ✓ · ${cadences}`;
        return (
          <button key={p.id} type="button" className={`mktile${line ? ' line' : ''}`}
            onClick={() => {
              if (!progress.complete && setupTask) return onOpenTask(setupTask.id);
              if (progress.complete && audit?.lastScore == null) return onAsk(room.id, playbookAsk(AUDIT));
              onScope(p.id);
            }}>
            <span className="mkt1">
              <ProjLogo logo={p.logo_url} name={p.name || p.slug} size={22} />
              <b>{p.name || p.slug}</b>
              {scored
                ? <span className="mkscore"><Dial score={audit!.lastScore!} /><b>{audit!.lastScore}</b></span>
                : <span className="mkcta">{progress.complete ? 'Run the baseline audit ›' : 'Finish setup ›'}</span>}
            </span>
            <span className="mkfacts">{facts}</span>
            <ConnStrip conns={conns} marketing={room.marketing} />
          </button>
        );
      })}
    </div>
  );
}
