// Every product capture ships in both themes, and the frame always shows the opposite one.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoFor, shotFor } from './theme';

const SHOTS = ['loop-build', 'home-web'];
const DEMOS = ['first-run'];

describe('product captures', () => {
  it('exist in both themes for every frame on the page', () => {
    for (const name of SHOTS) for (const t of ['dark', 'light']) {
      expect(existsSync(resolve(__dirname, `../public/shots/${name}-${t}.jpg`)), `${name}-${t}`).toBe(true);
    }
  });
  it('show the opposite theme of the page', () => {
    expect(shotFor('loop-build', 'light')).toBe('/shots/loop-build-dark.jpg');
    expect(shotFor('loop-build', 'dark')).toBe('/shots/loop-build-light.jpg');
  });
  it('the hero demo ships as a video and a poster in both themes, the opposite of the page', () => {
    for (const name of DEMOS) for (const t of ['dark', 'light']) for (const ext of ['mp4', 'jpg']) {
      expect(existsSync(resolve(__dirname, `../public/demo-${name}-${t}.${ext}`)), `demo-${name}-${t}.${ext}`).toBe(true);
    }
    expect(demoFor('first-run', 'light')).toEqual({ src: '/demo-first-run-dark.mp4', poster: '/demo-first-run-dark.jpg' });
    expect(demoFor('first-run', 'dark')).toEqual({ src: '/demo-first-run-light.mp4', poster: '/demo-first-run-light.jpg' });
  });
});
