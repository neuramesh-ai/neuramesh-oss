import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeChannel } from './home-channel';

const general = { id: 'general' }, build = { id: 'build' }, created = { id: 'created' };

test('Home honors an explicit channel before the project default', () => {
  assert.equal(homeChannel([general, build], 'build', 'general', null), build);
});

test('a project switch cannot retain a channel from the previous project', () => {
  assert.equal(homeChannel([build], 'old-project-room', 'old-project-default', null), build);
  assert.equal(homeChannel([], 'old-project-room', 'old-project-default', null), null);
});

test('channel creation cannot send to the old room while replication is pending', () => {
  assert.equal(homeChannel([general, build], 'created', 'general', 'created'), null);
  assert.equal(homeChannel([general, build, created], 'created', 'general', 'created'), created);
  assert.equal(homeChannel([general, build, created], 'created', 'general', null), created);
});
