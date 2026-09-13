// The Home stage's top sections — what NewChatStage renders above the greeting.
// Two tenants, one rule between them: each needs the human but is NOT a task, so neither
// ever joins the bell's needs-you count. The attention bar (failure-alerts round) exists
// only while something armed is broken; the invitation cards (0113) only while one is open.
// Extracted from App.tsx's topSections when the bar tipped it over the size ratchet.
import { AlertsBar } from './AlertsBar';
import { InviteCard, JoinedCard } from './join';
import type { Alert } from '@neuramesh/shared';
import type { PendingInvite } from '../bridge/rows-crew';

export function HomeTop({ alerts, refreshAlerts, dismissAlert, onOpenCalendar, onOpenRoutines, justJoined, wsInvites, currentWorkspace, onSwitchWorkspace, onDismissJoined, onInviteJoined, onInviteDismiss , onUpgrade}: {
  alerts: Alert[];
  refreshAlerts: () => void;
  dismissAlert: (key: string) => void;
  onOpenCalendar: () => void;
  onOpenRoutines: () => void;
  onUpgrade?: (reason: string) => void;
  justJoined: { workspaceId: string; workspaceName: string } | null;
  wsInvites: PendingInvite[];
  currentWorkspace: string;
  onSwitchWorkspace: (workspaceId: string) => void;
  onDismissJoined: () => void;
  onInviteJoined: (joined: PendingInvite) => void;
  /** declined: the question is answered, and a lingering prompt would ask it again */
  onInviteDismiss: (inviteId: string) => void;
}) {
  return (
    <>
      <AlertsBar alerts={alerts} refresh={refreshAlerts} dismiss={dismissAlert} onOpenCalendar={onOpenCalendar} onOpenRoutines={onOpenRoutines} onUpgrade={onUpgrade} />
      {(justJoined || wsInvites.length > 0) && (
        <div className="invstack">
          {justJoined && (
            <JoinedCard workspaceName={justJoined.workspaceName} currentWorkspace={currentWorkspace}
              onSwitch={() => onSwitchWorkspace(justJoined.workspaceId)} onDismiss={onDismissJoined} />
          )}
          {wsInvites.map((inv) => (
            <InviteCard key={inv.inviteId} invite={inv} currentWorkspace={currentWorkspace}
              onJoined={onInviteJoined} onDismiss={() => onInviteDismiss(inv.inviteId)} />
          ))}
        </div>
      )}
    </>
  );
}
