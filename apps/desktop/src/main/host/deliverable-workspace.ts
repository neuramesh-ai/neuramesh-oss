import { deliverablePath } from '../harness/brain';
import { hydratePath } from '../harness/hydration';

export async function hydratedDeliverablePath(taskNumber: number): Promise<string> {
  const path = deliverablePath(taskNumber);
  await hydratePath(path);
  return path;
}
