import { ipcRenderer } from 'electron';
// Who may open a workspace destination (Marketing, Finance). Generic: the Marketing access row reads it.
export const destinationBridge = {
  destinationAccess: (destination: 'finance' | 'marketing') => ipcRenderer.invoke('nm:destination-access', { destination }),
  destinationMember: (destination: 'finance' | 'marketing', input: { kind: 'human' | 'agent'; id: string; on: boolean }) => ipcRenderer.invoke('nm:destination-member', { destination, ...input }),
};
