import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureNarration } from './narration-measure.mjs';

const line = (text) => ({ text });

test('one traced turn: first visible text, progress lines per batch, tools and total time', () => {
  const lines = [
    line('[livestream] 1000 open k=ch1: a=rex'),
    line('[livestream] 1000 open k=ch1:th1 a=rex'),
    line('[livestream] 1001 flush k=ch1:th1 s=1 keep=0 add=0 len=0'),
    line('[livestream] 4000 flush k=ch1:th1 s=2 keep=0 add=0 len=0 th=40'),
    line('[livestream] 6000 flush k=ch1:th1 s=3 keep=0 add=30 len=30'),
    line('[livestream] 9000 flush k=ch1:th1 s=4 keep=0 add=0 len=0 pg=1'),
    line('[livestream] 20000 flush k=ch1:th1 s=5 keep=0 add=0 len=0 pg=2'),
    line('[livestream] 30000 flush k=ch1:th1 s=6 keep=0 add=500 len=500'),
    line('[livestream] 31000 end k=ch1:th1 s=7'),
    line('narration_stats lane=agy key=th1 outcome=end tools=4 batches=2 progress=2 thoughts=3 firstTextMs=5000 firstThoughtMs=3000 totalMs=30000'),
  ];
  const [turn, more] = measureNarration(lines);
  assert.equal(more, undefined, 'the room key mirrors the thread and is skipped');
  assert.equal(turn.thread, 'th1');
  assert.equal(turn.firstWordsMs, 5000);
  assert.equal(turn.firstProgressMs, 8000);
  assert.equal(turn.firstVisibleMs, 5000);
  assert.equal(turn.firstThoughtMs, 3000);
  assert.equal(turn.progressLines, 2);
  assert.equal(turn.tools, 4);
  assert.equal(turn.batches, 2);
  assert.equal(turn.progressPerBatch, 1);
  assert.equal(turn.totalMs, 30000);
  assert.equal(turn.lane, 'agy');
});

test('a thread filter and lines in any order', () => {
  const lines = [
    line('[livestream] 2000 end k=c:a s=3'),
    line('[livestream] 1000 open k=c:a a=rex'),
    line('[livestream] 1500 flush k=c:a s=2 keep=0 add=4 len=4'),
    line('[livestream] 1000 open k=c:b a=iris'),
    line('unrelated line'),
  ];
  const turns = measureNarration(lines, { thread: 'a' });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].firstVisibleMs, 500);
  assert.equal(turns[0].totalMs, 1000);
  assert.equal(turns[0].tools, undefined, 'no narration_stats line, no tool count');
});
