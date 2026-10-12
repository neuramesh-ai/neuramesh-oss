import { CODE_GEMINI_NOTE } from '@neuramesh/shared';
import type { ComponentProps } from 'react';
import { AgentChip } from './AgentChip';
import { ModelChip } from './ModelChip';

/** The same agent and model controls on every composer. Adapters provide routing, never markup. */
export function ComposerAgentControls({ part = 'both', disabled, ...props }: ComponentProps<typeof AgentChip> & { part?: 'both' | 'model' | 'agent' }) {
  const target = props.answerer ?? props.agents[0] ?? null;
  return <>
    {part !== 'agent' && target && <ModelChip notes={props.modelScope === 'thread' ? { gemini: CODE_GEMINI_NOTE } : undefined} who={target} seat={props.seatOf(target)} states={props.states} onConnect={props.onConnect} onPick={(m, t) => props.onPick(target, m, t)} disabled={disabled} />}
    {part !== 'model' && <AgentChip {...props} disabled={disabled} />}
  </>;
}
