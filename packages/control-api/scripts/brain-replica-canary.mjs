import assert from 'node:assert/strict';

// The caller owns isolated canary workspaces and revokes their machine tokens in finally.
// Run against the actual ingress before any client starts depending on the replacement feed.
export async function verifyReplicaIngress({ owner, foreign, sql, call, check }) {
  const bootstrap = '/v1/brain/replica/bootstrap';
  let cursor;
  await check('replica ingress requires authentication and isolates machine workspaces', async () => {
    assert.equal((await call(null, bootstrap)).status, 401);
    for (const identity of [owner, foreign]) {
      const response = await call(identity, bootstrap);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const batch = await response.json();
      assert.equal(batch.schemaVersion, 1);
      assert.deepEqual(batch.workspaces, [identity.workspace]);
      assert.ok(batch.changes.some(change => change.table === 'projects' && change.id === identity.project));
      const other = identity === owner ? foreign : owner;
      assert.ok(!batch.changes.some(change => change.id === other.project || change.id === other.machine));
      for (const change of batch.changes) {
        if (change.row?.workspace_id) assert.equal(change.row.workspace_id, identity.workspace);
        assert.ok(!Object.hasOwn(change.row ?? {}, 'token_hash'));
      }
      if (identity === owner) cursor = batch.cursor;
    }
    assert.equal(typeof cursor, 'string');
    const denied = await call(foreign, `/v1/brain/replica/changes?cursor=${encodeURIComponent(cursor)}`);
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).code, 'RESET_REQUIRED');
  });
  await check('replica ingress returns committed project changes', async () => {
    const name = 'Brain replica ingress canary';
    await sql`update projects set name=${name} where id=${owner.project}::uuid and workspace_id=${owner.workspace}::uuid`;
    let found = false;
    for (let page = 0; page < 100; page++) {
      const response = await call(owner, `/v1/brain/replica/changes?cursor=${encodeURIComponent(cursor)}`);
      assert.equal(response.status, 200);
      const batch = await response.json();
      assert.deepEqual(batch.workspaces, [owner.workspace]);
      assert.ok(!batch.changes.some(change => change.id === foreign.project));
      found ||= batch.changes.some(change => change.table === 'projects' && change.id === owner.project && change.row?.name === name);
      cursor = batch.cursor;
      if (found || !batch.hasMore) break;
    }
    assert.ok(found, 'the committed project update must reach the authenticated change feed');
  });
  return cursor;
}
