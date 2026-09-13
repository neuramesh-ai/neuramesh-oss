// What a new workspace starts with. Extracted from App.tsx (track A2).


export const DEFAULT_CHANNELS = ['general', 'build', 'research', 'marketing'];

// The starter team created alongside your orchestrator so the loop has real hands on day one:
// a designer to draw, an architect to plan, a developer to build, a reviewer to gate.
// Names carry brand personas.
export const DEFAULT_TEAM: Array<{ name: string; role: string }> = [
  { name: 'iris', role: 'designer' },
  { name: 'atlas', role: 'architect' },
  { name: 'patch', role: 'developer' },
  { name: 'scout', role: 'reviewer' },
  { name: 'bosun', role: 'shipper' },
];
