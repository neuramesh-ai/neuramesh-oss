import { describe, expect, it } from 'vitest';
import { normalizeTaskMarkdown } from '../src/task-handoff';

describe('task Markdown recovery', () => {
  it('recovers double-escaped prose sections and lists', () => {
    expect(normalizeTaskMarkdown('Build the page.\\n\\nRequirements:\\n1. Add the route.\\n2. Run tests.')).toBe('Build the page.\n\nRequirements:\n1. Add the route.\n2. Run tests.');
  });
  it('preserves fenced code, inline strings, paths and already formatted prose', () => {
    const text = '## Steps\n1. Read `"\\n\\n"` and C:\\new\\notes.\n```js\nconst text = "\\n\\n";\n```\n\nRun tests.';
    expect(normalizeTaskMarkdown(text)).toBe(text);
  });
});
