import type { EngineeringTaskConnectionState } from '@neuramesh/shared';
import { IconAlert } from '../ui/icons';

/** Connection status belongs beside the pending approval, not in the agent transcript. */
export function CodingTaskConnection({ state, onReconnect }: { state: EngineeringTaskConnectionState | null; onReconnect: () => void }) {
  if (!state || state.phase === 'connected') return null;
  const offline = state.phase === 'offline';
  return <div className="engnotice" role="status" aria-live="polite">
    <span className="engnoticeico"><IconAlert s={14} /></span>
    <span className="engnoticecopy"><b>{offline ? 'Coding task connection lost' : state.phase === 'connecting' ? 'Connecting to coding task…' : 'Reconnecting to coding task…'}</b>
      <span>{offline ? state.detail : 'Restoring live status and pending approvals.'}</span>
      <span>Reconnect to review any waiting command. Your task stays on its runner.</span>
      <span><button className="btn sm" onClick={onReconnect}>Reconnect now</button></span>
    </span>
  </div>;
}
