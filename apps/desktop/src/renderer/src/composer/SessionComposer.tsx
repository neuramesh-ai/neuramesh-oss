import type { ReactNode } from 'react';
import { ComposerInput } from './ComposerInput';

/** One input and control row for new sessions, chat replies and coding turns. */
export function SessionComposer({ input, before, controls, after, rowClass = 'trow' }: {
  input: ReactNode; before?: ReactNode; controls: ReactNode; after?: ReactNode; rowClass?: string;
}) {
  return <>{before}{input}<div className={rowClass}>{controls}</div>{after}</>;
}

SessionComposer.Input = ComposerInput;
