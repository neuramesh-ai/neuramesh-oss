import test from 'node:test';
import assert from 'node:assert/strict';
import { PULSE_BUCKETS, pulseSelects } from './projmeta';

// The full board FSM (docs/06 + docs/23/24). If a new state joins the FSM, this list —
// and therefore a bucket decision — must be updated with it: an unmapped open state
// would silently vanish from every project card's pulse strip.
const OPEN_STATES = [
  'backlog', 'todo', 'designing', 'design_review', 'planning', 'plan_review',
  'in_progress', 'blocked', 'in_review', 'done', 'shipping', 'ship_review',
  'verifying', 'releasing',
];
const TERMINAL_STATES = ['accepted', 'closed'];

test('every open FSM state maps to exactly one pulse bucket', () => {
  const mapped = Object.values(PULSE_BUCKETS).flat() as string[];
  assert.deepEqual([...mapped].sort(), [...OPEN_STATES].sort());
  assert.equal(new Set(mapped).size, mapped.length, 'a state appears in two buckets');
});

test('terminal states stay out of the pulse', () => {
  const mapped = new Set(Object.values(PULSE_BUCKETS).flat() as string[]);
  for (const s of TERMINAL_STATES) assert.ok(!mapped.has(s), `${s} must not be counted`);
});

test('pulseSelects emits one aliased count per bucket on the given table alias', () => {
  const sql = pulseSelects('p');
  for (const k of Object.keys(PULSE_BUCKETS)) {
    assert.match(sql, new RegExp(`as t_${k}\\b`));
  }
  assert.match(sql, /tb\.project_id = p\.id/);
  const custom = pulseSelects('proj');
  assert.match(custom, /tb\.project_id = proj\.id/);
  // states render as quoted SQL literals, comma-separated
  assert.match(sql, /'in_progress', 'blocked'/);
});
