// Agent persona + avatar derivation — extracted from App.tsx (track A3).
// STORED_PERSONA/STORED_ROLE are module singletons on purpose: rememberPersonas fills them
// from the synced roster so any component can render a face without threading the roster.
import { createAvatar } from '@dicebear/core';
import * as thumbs from '@dicebear/thumbs';

// Agent personas — an animal emoji on a tone-colored tile, deterministic per name
// (handoff App.dc.html: rex 🦊 ember · patch 🦉 green · scout 🐝 warm · gem 🦅 blue).
// These are brand *identity*, so they replace the generic DiceBear bots in the UI.
export const PERSONA_OVERRIDE: Record<string, { emoji: string; tone: string }> = {
  rex: { emoji: '🦊', tone: 'accent' },
  atlas: { emoji: '🦫', tone: 'violet' },
  patch: { emoji: '🦉', tone: 'green' },
  scout: { emoji: '🐝', tone: 'warm' },
  gem: { emoji: '🦅', tone: 'blue' },
  iris: { emoji: '🦋', tone: 'violet' },
};

export const PERSONA_EMOJI = ['🦊', '🦉', '🐝', '🦅', '🦫', '🦝', '🐢', '🦎', '🐙', '🦋', '🐬', '🦜', '🦥', '🐲', '🦏', '🦒'];

export const PERSONA_TONE = ['accent', 'green', 'warm', 'blue', 'violet'];

export function persona(name: string): { emoji: string; tone: string } {
  const k = (name || '').toLowerCase().trim();
  if (PERSONA_OVERRIDE[k]) return PERSONA_OVERRIDE[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return { emoji: PERSONA_EMOJI[h % PERSONA_EMOJI.length]!, tone: PERSONA_TONE[h % PERSONA_TONE.length]! };
}

// Human-picked persona faces for the active workspace, keyed by agent name. Populated from the
// roster (before its state commits) so every avatar — roster, message authors, activity — shows
// the chosen emoji by name, without threading it through each call site.
export const STORED_PERSONA = new Map<string, string>();

// name → role, populated from the roster like STORED_PERSONA, so every avatar (roster, message
// authors, activity) can tint by role without threading it through each call site.
export const STORED_ROLE = new Map<string, string>();

export function rememberPersonas(agents: { name: string; emoji?: string | null; role?: string | null }[]) {
  for (const a of agents) {
    const k = (a.name || '').toLowerCase().trim();
    if (a.emoji) STORED_PERSONA.set(k, a.emoji);
    if (a.role) STORED_ROLE.set(k, String(a.role).toLowerCase());
  }
}

export function personaRole(name: string): string | undefined {
  return STORED_ROLE.get((name || '').toLowerCase().trim());
}

// Agent faces are DiceBear "Thumbs" — playful blob characters generated on-device from the
// agent's name (deterministic seed, no network, CC0-licensed). Memoized per seed; the SVG is
// vector, so one data-URI serves every render size. This replaces the emoji personas
// (bots > emoji — founder call 2026-07-24); the tile stays neutral, the role lives on the chip.
export const THUMB_CACHE = new Map<string, string>();

export function thumbAvatar(name: string): string {
  const seed = (name || '').toLowerCase().trim() || 'agent';
  let uri = THUMB_CACHE.get(seed);
  if (uri === undefined) {
    const svg = createAvatar(thumbs, { seed, size: 128 }).toString();
    uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    THUMB_CACHE.set(seed, uri);
  }
  return uri;
}
