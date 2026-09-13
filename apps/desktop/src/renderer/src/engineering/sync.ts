/** Coalesces high-frequency streaming updates before they reach synchronous browser storage or
 * the workspace shell. Calling the returned function cancels the pending update. */
export function scheduleEngineeringSync(sync: () => void, delay = 200): () => void {
  const timer = setTimeout(sync, delay);
  return () => clearTimeout(timer);
}
