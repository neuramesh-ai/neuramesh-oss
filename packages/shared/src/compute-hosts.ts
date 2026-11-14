// WHAT A MACHINE CAN HOST (round 5: the sandbox's "serves 0 of 8"). One rule for every surface
// that counts the agents a machine serves, and it is the claim ladder's own (runtimeOk). The house
// brain needs no runtime, because its turns go through control-api's metered proxy, so any machine
// hosts it. Every other agent needs its runtime installed or keyed on the machine. hq and the
// desktop each counted by runtime alone, so a runner with no sign-in "served" none of the
// house-brain agents it was serving.
import { runtimeOk } from './compute';

/** the two fields of an agent that decide which machines can host it */
export interface HostedAgentNeed { runtime?: string | null; model?: string | null }

/** can a machine with these runtimes host this agent? An agent with no runtime is a claude-code one */
export function hostsAgent(runtimes: readonly string[], agent: HostedAgentNeed): boolean {
  return runtimeOk({ machineId: '', ownerUserId: '', lastSeenAt: null, runtimes }, { runtime: agent.runtime ?? 'claude-code', model: agent.model ?? null });
}
