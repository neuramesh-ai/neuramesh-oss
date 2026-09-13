import { describe, expect, it } from 'vitest';
import { ShipItemSchema, shipItemsPending, type ShipPlan } from '../src/task';

const item = (over: Partial<ReturnType<typeof ShipItemSchema.parse>>) =>
  ShipItemSchema.parse({ id: 'x', title: 'x', owner: 'shipper', ...over });

const plan = (items: ReturnType<typeof item>[]): ShipPlan => ({
  round: 1, risk: 'low', summary: '', status: 'approved', shipperId: 'a-1',
  approvedBy: 'u-1', approvedAt: new Date().toISOString(), revisions: 0, items,
});

describe('shipItemsPending', () => {
  it('counts open gate items', () => {
    expect(shipItemsPending(plan([item({ id: 'a' }), item({ id: 'b', state: 'done' }), item({ id: 'c', state: 'na' })]))).toBe(1);
  });
  it('the rollout spine never blocks execute_ship — merge/verify are outcomes, not gates', () => {
    expect(shipItemsPending(plan([
      item({ id: 'ci', auto: 'ci', state: 'done' }),
      item({ id: 'merge-pr', auto: 'merge' }),
      item({ id: 'verify-release', auto: 'verify' }),
    ]))).toBe(0);
  });
  it('a pending ci item still gates', () => {
    expect(shipItemsPending(plan([item({ id: 'ci', auto: 'ci' }), item({ id: 'merge-pr', auto: 'merge' })]))).toBe(1);
  });
  it('schema accepts the spine auto kinds', () => {
    expect(item({ auto: 'merge' }).auto).toBe('merge');
    expect(item({ auto: 'verify' }).auto).toBe('verify');
  });
});
