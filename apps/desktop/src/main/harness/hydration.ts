// Files absent from the local cache can still exist in the machine's saved manifest.
// Callers must hydrate before deciding to create, reclaim or replace a workspace.
export interface Hydration {
  ensure(path: string): Promise<void>;
  matching(test: (path: string) => boolean): Promise<void>;
  pending(path: string): boolean;
}
let current: Hydration | null = null;
export function useHydration(next: Hydration | null): void { current = next; }
export async function hydratePath(path: string): Promise<void> { await current?.ensure(path); }
export async function hydrateMatching(test: (path: string) => boolean): Promise<void> { await current?.matching(test); }
export function hydrationPending(path: string): boolean { return current?.pending(path) ?? false; }
export function assertHydrated(path: string): void {
  if (hydrationPending(path)) throw new Error('This saved workspace is still loading. Wait for restoration before reading or changing its files.');
}
