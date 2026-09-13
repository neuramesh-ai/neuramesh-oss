import { test, expect } from 'vitest';
import { parseBrandGuidelines, buildImagePrompt, EMPTY_BRAND } from '../src/brandimage';

// The shape the marketing bootstrap actually writes (agents.ts runMarketingBootstrap).
const GUIDELINES = `# Brand Guidelines — Flowe

## Color Palette

| Role | Hex |
| --- | --- |
| Background | #0B0B0C |
| Text | #F5F3EE |
| Primary | #E8734A |
| Accent | #7A9E7E |

Mood: warm, nocturnal, unhurried.

## Typography

Headings use \`Sohne\`, body copy uses \`Inter\`, 1.55 line height.

## Brand Voice

Warm and plain-spoken. Never salesy. Speak to one tired person, not a market.

## Visual Style

Low-light photography, warm gold light sources, deep shadow, generous negative space.

## What to Avoid

Stock-photo handshakes, neon gradients, cluttered dashboards, exclamation marks.
`;

test('parseBrandGuidelines: reads the palette table in document order', () => {
  const t = parseBrandGuidelines(GUIDELINES);
  expect(t.palette).toEqual([
    { role: 'Background', hex: '#0b0b0c' },
    { role: 'Text', hex: '#f5f3ee' },
    { role: 'Primary', hex: '#e8734a' },
    { role: 'Accent', hex: '#7a9e7e' },
  ]);
});

test('parseBrandGuidelines: reads typography, voice, visual style and avoid', () => {
  const t = parseBrandGuidelines(GUIDELINES);
  expect(t.fonts).toEqual(['Sohne', 'Inter']);
  expect(t.voice).toMatch(/warm and plain-spoken/i);
  expect(t.visualStyle).toMatch(/low-light photography/i);
  expect(t.avoid).toMatch(/neon gradients/i);
});

test('parseBrandGuidelines: accepts a list-shaped palette and skips the header row', () => {
  const t = parseBrandGuidelines('## Color Palette\n\n- Background: #101010\n- Primary: #c33\n');
  expect(t.palette).toEqual([{ role: 'Background', hex: '#101010' }, { role: 'Primary', hex: '#c33' }]);
});

test('parseBrandGuidelines: a doc with no brand content degrades, never throws', () => {
  expect(parseBrandGuidelines('# Notes\n\nnothing useful here')).toEqual({ palette: [], fonts: [], voice: undefined, visualStyle: undefined, avoid: undefined });
  expect(parseBrandGuidelines('')).toEqual(EMPTY_BRAND);
  expect(parseBrandGuidelines(undefined as unknown as string)).toEqual(EMPTY_BRAND);
});

test('buildImagePrompt: binds the exact palette and bans text by default', () => {
  const spec = buildImagePrompt('A single warm-gold lamp in a dark room past midnight.', parseBrandGuidelines(GUIDELINES), 'x', 'flowe.app');
  expect(spec).not.toBeNull();
  expect(spec!.prompt).toContain('#e8734a');
  expect(spec!.prompt).toContain('use these exact colours and no others');
  expect(spec!.prompt).toContain('no text, letters, words or numbers anywhere in the image');
  expect(spec!.prompt).toContain('flowe.app');
  expect(spec!.prompt).toContain('Avoid: Stock-photo handshakes');
});

test('buildImagePrompt: a brief that asks for a headline gets lettering in the brand font instead', () => {
  const spec = buildImagePrompt('Quote card with the headline "Your agents forget. Ours remember."', parseBrandGuidelines(GUIDELINES), 'instagram');
  expect(spec!.prompt).toContain('Sohne');
  expect(spec!.prompt).not.toContain('no text, letters, words or numbers');
});

test('buildImagePrompt: canvas follows the network', () => {
  const brief = 'a lamp';
  expect(buildImagePrompt(brief, EMPTY_BRAND, 'x')!.size).toBe('1536x1024');
  expect(buildImagePrompt(brief, EMPTY_BRAND, 'instagram')!.size).toBe('1024x1024');
  expect(buildImagePrompt(brief, EMPTY_BRAND, 'tiktok')!.size).toBe('1024x1536');
  expect(buildImagePrompt(brief, EMPTY_BRAND, 'unknown-network')!.size).toBe('1536x1024');
  expect(buildImagePrompt(brief, EMPTY_BRAND, 'tiktok')!.prompt).toContain('tall 2:3 vertical');
});

test('buildImagePrompt: no brief means no image', () => {
  expect(buildImagePrompt('', EMPTY_BRAND, 'x')).toBeNull();
  expect(buildImagePrompt('   ', EMPTY_BRAND, 'x')).toBeNull();
});

test('buildImagePrompt: survives a brand with nothing in it', () => {
  const spec = buildImagePrompt('a lamp', EMPTY_BRAND, 'x');
  expect(spec!.prompt).toContain('Subject: a lamp');
  expect(spec!.prompt).not.toContain('Brand palette');
});
