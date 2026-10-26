const RELAY_HIGH_WATER_BYTES = 512 * 1024;

/** Bound queued socket bytes without dropping an upload or blocking other channels. */
export async function waitForRelayCapacity(
  sock: Pick<WebSocket, 'bufferedAmount' | 'readyState'>,
  highWater = RELAY_HIGH_WATER_BYTES,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 8)),
): Promise<void> {
  while (sock.bufferedAmount > highWater) {
    if (sock.readyState !== WebSocket.OPEN) throw new Error('The relay connection closed during upload.');
    await wait();
  }
}
