export interface EngineeringModeHandoff {
  category: 'edit' | 'command';
  toolName: string;
  prompt: string;
  createdAt: string;
}

export function engineeringModeHandoff(category: 'edit' | 'command', toolName: string): EngineeringModeHandoff {
  return {
    category,
    toolName,
    prompt: category === 'edit'
      ? 'Continue with the implementation in Act mode. Apply the planned changes and verify them.'
      : 'Continue in Act mode. Apply the planned changes, run the requested commands, and finish the verification.',
    createdAt: new Date().toISOString(),
  };
}
