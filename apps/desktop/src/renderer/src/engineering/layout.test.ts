import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  ENGINEERING_COMPOSER_WIDTH_DEFAULT,
  ENGINEERING_COMPOSER_WIDTH_MIN,
  clampEngineeringComposerWidth,
  loadEngineeringComposerWidth,
} from './layout';

test('Engineering composer width preserves usable conversation and editor panes', () => {
  assert.equal(clampEngineeringComposerWidth(100, 1200), ENGINEERING_COMPOSER_WIDTH_MIN);
  assert.equal(clampEngineeringComposerWidth(560, 1200), 560);
  assert.equal(clampEngineeringComposerWidth(900, 1000), 555);
});

test('Engineering composer width has a deterministic non-browser default', () => {
  assert.equal(loadEngineeringComposerWidth(), ENGINEERING_COMPOSER_WIDTH_DEFAULT);
});

test('Engineering work tabs share the live editor split coordinate', () => {
  const css = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf8');
  const resize = readFileSync(join(import.meta.dirname, 'EngineeringComposerResize.tsx'), 'utf8');
  const strip = readFileSync(join(import.meta.dirname, '../WorkspaceTabs.tsx'), 'utf8');
  const editor = readFileSync(join(import.meta.dirname, 'EngineeringEditor.tsx'), 'utf8');
  assert.match(strip, /className="wtlead"/);
  assert.match(resize, /setProperty\('--eng-composer-width', `\$\{width\}px`\)/);
  assert.match(css, /\.engworkspaceheader \{[^}]*grid-template-columns: var\(--eng-composer-width, 420px\) 9px minmax\(0, 1fr\);/);
  assert.match(css, /\.wtstrip:has\(\.engworkspaceheader\) \.wtcontext \{ grid-column: 1;/);
  assert.match(editor, /className="engworkspaceidentity"[\s\S]*<EngineeringWorkspaceTabs/);
  assert.match(editor, /aria-label="Open a Code terminal"/);
  assert.match(editor, /onClick=\{\(\) => select\('terminal'\)\}/);
  assert.match(editor, /requestAnimationFrame\(\(\) => scrollEngineeringPane\('\.engeditor'\)\)/);
  assert.match(editor, /<TerminalView ref=\{terminal\}/);
  assert.doesNotMatch(editor, /onTerminal/);
  assert.match(css, /\.engsplitterbar \{[^}]*height: 68px;[^}]*background: var\(--border2\);/);
  assert.doesNotMatch(css, /\.engsplitter \{[^}]*border-inline:/);
});

test('Code workspace chrome yields when a non-Code task or conversation owns the surface', () => {
  const app = readFileSync(join(import.meta.dirname, '../App.tsx'), 'utf8');
  assert.match(app, /const engineeringContextOn = view === 'engineering' && !openTaskId && !openThreadId;/);
  assert.match(app, /context=\{engineeringContextOn \? <EngineeringWorkspaceHeader/);
});

test('Code hides native scroll gutters and offers a contextual jump to the latest message', () => {
  const css = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf8');
  const view = readFileSync(join(import.meta.dirname, '../views/EngineeringOS.tsx'), 'utf8');
  assert.match(css, /\.engmessages \{[^}]*scrollbar-width: none;/);
  assert.match(css, /\.engrecent \{[^}]*scrollbar-width: none;/);
  assert.match(css, /\.engmessages::\-webkit-scrollbar \{[^}]*display: none;/);
  assert.match(css, /\.engrecent::\-webkit-scrollbar \{[^}]*display: none;/);
  assert.match(view, /showJumpToBottom/);
  assert.match(view, /aria-label="Scroll to latest message"/);
  assert.match(view, /behavior: 'smooth'/);
});

test('Code home keeps creation lazy, reuses the launch character, and incrementally reveals recents', () => {
  const view = readFileSync(join(import.meta.dirname, '../views/EngineeringOS.tsx'), 'utf8');
  const app = readFileSync(join(import.meta.dirname, '../App.tsx'), 'utf8');
  assert.match(view, /<CaughtUpPeek play \/>/);
  assert.match(view, /new IntersectionObserver/);
  assert.match(view, /setVisibleCount\(\(count\) => Math\.min\(count \+ 5, sorted\.length\)\)/);
  assert.match(view, />View all <span aria-hidden>→<\/span><\/button>/);
  assert.match(view, /<EngineeringCodeHistory sessions=\{sorted\}/);
  assert.match(app, /onHome=\{engineeringNav\.home\} onNew=\{engineeringNav\.home\}/);
});

test('Code handoff and approvals use borderless symmetric entrance and exit motion', () => {
  const css = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf8');
  const composer = readFileSync(join(import.meta.dirname, 'EngineeringComposer.tsx'), 'utf8');
  const view = readFileSync(join(import.meta.dirname, '../views/EngineeringOS.tsx'), 'utf8');
  assert.match(css, /\.engmodegate \{[^}]*border: 0;[^}]*transform-origin: bottom center;/);
  assert.match(css, /\.engapproval \{[^}]*border: 0;[^}]*transform-origin: bottom center;/);
  assert.match(css, /@keyframes eng-prompt-in/);
  assert.match(css, /@keyframes eng-prompt-out/);
  assert.match(composer, /data-state=\{closing \? 'closing' : 'open'\}/);
  assert.match(view, /data-state=\{closing \? 'closing' : 'open'\}/);
});

test('Code history uses mode markers and the left-nav thread typography', () => {
  const css = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf8');
  const activity = readFileSync(join(import.meta.dirname, 'EngineeringActivity.tsx'), 'utf8');
  const view = readFileSync(join(import.meta.dirname, '../views/EngineeringOS.tsx'), 'utf8');
  assert.match(activity, /engstatedot mode-\$\{session\.mode\}/);
  assert.match(css, /\.engstatedot\.mode-plan \{[^}]*background: transparent;[^}]*border: 1\.5px solid var\(--plan\);/);
  assert.match(css, /\.engstatedot\.mode-act \{[^}]*background: var\(--prog\);/);
  assert.doesNotMatch(css, /\.engstatedot\.completed, \.engstatedot\.idle \{[^}]*var\(--done\)/);
  assert.match(css, /\.engrecent b \{[^}]*color: var\(--body\);[^}]*font-size: 12\.5px;[^}]*font-weight: 500;/);
  assert.match(view, /engrecentproject/);
});

test('Code landing reserves runtime chrome for actionable connection states', () => {
  const view = readFileSync(join(import.meta.dirname, '../views/EngineeringOS.tsx'), 'utf8');
  // the notice renders ONLY when the runtime is not ready, and wears the notice recipe (rail-ink round 3)
  assert.match(view, /runtime !== 'ready' \? <div className=\{`engnotice engruntime/);
  assert.doesNotMatch(view, />Code connected</);
  assert.doesNotMatch(view, /Plan, act, permissions, repository tools, and model execution are ready\./);
  assert.match(view, /Code unavailable/);
});

test('Code primary approvals and context selectors stay inside the shared composer surface', () => {
  const css = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf8');
  const composer = readFileSync(join(import.meta.dirname, 'EngineeringComposer.tsx'), 'utf8');
  assert.match(css, /\.engapprovalactions \.primary \{[^}]*background: var\(--brand\);[^}]*border-color: var\(--brand\);/);
  assert.match(css, /\.engapprovalactions \.primary:hover \{[^}]*background: color-mix\(in srgb, var\(--brand\) 88%, var\(--text\)\);/);
  assert.match(composer, /<div className="engcompose cbox">[\s\S]*<div className="engcomposebar row">[\s\S]*<div className="engmodebar row">[\s\S]*<\/div>[\s\S]*\{permissionsOpen/);
  assert.equal(composer.match(/<div className="engmodebar row">/g)?.length, 1);
  assert.match(css, /\.cbox \.engmodebar\.row \{[^}]*flex-wrap: nowrap;/);
  assert.match(css, /\.engmodebar \.cchip \{ min-height: 30px; \}/);
  assert.match(css, /\.engmodebar \.engmodes\.threadseg \{[^}]*min-height: 30px;[^}]*border-color: transparent;[^}]*border-radius: var\(--r-pill\);[^}]*background: transparent;/);
});

test('Code reasoning uses the reusable AI CSS component without card chrome', () => {
  const transcript = readFileSync(join(import.meta.dirname, 'EngineeringActivity.tsx'), 'utf8');
  const component = readFileSync(join(import.meta.dirname, 'ThinkingReasoning.tsx'), 'utf8');
  const styles = readFileSync(join(import.meta.dirname, 'ThinkingReasoning.module.css'), 'utf8');
  const tokens = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf8');

  assert.match(transcript, /import \{ ThinkingReasoning \} from '\.\/ThinkingReasoning';/);
  assert.match(transcript, /<ThinkingReasoning[\s\S]*thinking=\{Boolean\(message\.streaming\)\}/);
  assert.match(component, /Source: https:\/\/www\.aicss\.dev\/components\/thinking-reasoning/);
  assert.match(component, /className=\{styles\.trStream\}/);
  assert.match(component, /<span className=\{styles\.trVerb\}>Thought<\/span>/);
  assert.match(styles, /\.trHeader \{[\s\S]*border: 0;[\s\S]*background: transparent;/);
  assert.doesNotMatch(tokens, /\.engreason(?:\s|\.|\{|,)/);
});

test('Code activity and working states remain borderless transcript rows', () => {
  const css = readFileSync(join(import.meta.dirname, '../tokens.css'), 'utf8');
  assert.match(css, /\.engactivity \{[^}]*overflow: hidden;[^}]*\}/);
  assert.doesNotMatch(css, /\.engactivity \{[^}]*border/);
  assert.doesNotMatch(css, /\.engactivity \{[^}]*background/);
  assert.doesNotMatch(css, /\.engworking \{[^}]*border/);
  assert.doesNotMatch(css, /\.engworking \{[^}]*background/);
});
