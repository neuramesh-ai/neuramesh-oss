// ${VAR} substitution over the YAML templates in infra/k8s/templates. strict by design:
// an unknown or missing var throws, because a silently-empty field in a rendered manifest
// is how quota and isolation bugs ship. lines tagged `#optional` are dropped entirely when
// their substituted value is empty — that is how `runtimeClassName`/`storageClassName`
// vanish on k3d instead of rendering as invalid empty strings.

import { loadAll } from 'js-yaml';
import { readFileSync } from 'node:fs';
import type { KubeObject } from './types.js';

const VAR = /\$\{([A-Z0-9_]+)\}/g;

export function renderTemplate(text: string, vars: Record<string, string>): string {
  const lines = text.split('\n').map((line) => {
    const optional = /#optional\s*$/.test(line);
    let empty = false;
    const rendered = line.replace(VAR, (_, name: string) => {
      const value = vars[name];
      if (value === undefined) throw new Error(`template var ${name} is not provided`);
      if (value === '') empty = true;
      return value;
    });
    if (optional && empty) return null;
    return optional ? rendered.replace(/\s*#optional\s*$/, '') : rendered;
  });
  return lines.filter((l): l is string => l !== null).join('\n');
}

/** render, split multi-doc YAML, parse — the shape the planner and SSA both consume */
export function renderDocs(text: string, vars: Record<string, string>): KubeObject[] {
  const docs = loadAll(renderTemplate(text, vars)) as (KubeObject | null)[];
  return docs.filter((d): d is KubeObject => d != null && typeof d === 'object');
}

export function loadTemplate(path: string): string {
  return readFileSync(path, 'utf8');
}
