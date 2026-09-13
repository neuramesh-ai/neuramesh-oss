// The roster context an agent face reads to open its card — own module so both the
// provider (App) and the consumer (AgentFace) import it without a cycle.
import { createContext } from 'react';
import type { AgentRow } from '../bridge/rows-crew';

/**
 * The agent directory: who is in this workspace, and how to open one. Provided once at the app
 * root so `AgentAvatar` resolves a name without every call site threading the roster through —
 * which is what keeps the hover card ONE card rather than three that drift.
 */
export const AgentDirectory = createContext<{ byName: Map<string, AgentRow>; open: (a: AgentRow) => void } | null>(null);
