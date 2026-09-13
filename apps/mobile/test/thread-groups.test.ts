// GROUP ORDER IS THE FEATURE. The rows arrive sorted by recency, so the group order decides whether
// the project you touched an hour ago sits at the top or under one that has been quiet for a month.
import { describe, expect, it } from 'vitest';
import { groupByProject, NO_PROJECT } from '../src/thread-groups';

const row = (key: string, channelId: string | null) => ({ key, channelId });

// #marketing and #general belong to Flowe AI; #build to Default; #stray to nothing
const projectOf = (channelId: string | null) =>
  channelId === 'marketing' || channelId === 'general' ? { id: 'p-flowe', name: 'Flowe AI' }
    : channelId === 'build' ? { id: 'p-default', name: 'Default' }
      : null;

describe('groupByProject', () => {
  it('collects a project\'s rooms into one group', () => {
    const groups = groupByProject([row('a', 'marketing'), row('b', 'general')], projectOf);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('Flowe AI');
    expect(groups[0]?.rows.map((r) => r.key)).toEqual(['a', 'b']);
  });

  it('orders groups by FIRST APPEARANCE, so the most recent project leads', () => {
    // rows come in recency order: a Default row is newest here
    const groups = groupByProject([row('a', 'build'), row('b', 'marketing'), row('c', 'general')], projectOf);
    expect(groups.map((g) => g.label)).toEqual(['Default', 'Flowe AI']);
  });

  it('keeps each group\'s rows in the order they arrived', () => {
    const groups = groupByProject([row('a', 'marketing'), row('b', 'build'), row('c', 'general')], projectOf);
    expect(groups[0]?.rows.map((r) => r.key)).toEqual(['a', 'c']);
    expect(groups[1]?.rows.map((r) => r.key)).toEqual(['b']);
  });

  it('parks a room with no project under one sentinel rather than dropping it', () => {
    // a room the replica has not synced its project for must still be reachable
    const groups = groupByProject([row('a', 'stray'), row('b', null)], projectOf);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(NO_PROJECT);
    expect(groups[0]?.rows.map((r) => r.key)).toEqual(['a', 'b']);
  });

  it('is empty for no rows, so the screen can say so itself', () => {
    expect(groupByProject([], projectOf)).toEqual([]);
  });
});
