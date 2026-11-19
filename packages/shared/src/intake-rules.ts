// THE BUILD RULE (round 9, intake). A pure, deterministic check for a clear request to build, change
// or fix software. Intake (control-api src/intake.ts) runs it before and beside the starter brain:
//   - a rule hit makes the intake kind `coding`, even when the model is unsure or unavailable,
//   - a miss decides nothing. The model, or else the selected agent, decides the rest.
//
// The rule is narrow on purpose. A false hit turns a conversation into a coding thread, which is a
// bigger mistake than a miss (the agent can still start a coding session itself). So the rule needs
// both a build verb near the start and a software noun as the first thing the verb works on, and a
// question ("what is", "explain", "how do I") never hits.
//
// NO IMPORTS, on purpose: the offline intake eval (scripts) loads this file straight into Node 24.

export interface BuildRuleHit {
  hit: boolean;
  /** the build verb that matched, for the log */
  verb?: string;
  /** the software noun that matched, for the log */
  noun?: string;
}

/** Verbs that ask for software work when a software noun follows them. Multi-word verbs come first. */
const VERBS = [
  'set up', 'wire up', 'spin up', 'put together', 'build', 'create', 'make', 'implement', 'code', 'develop', 'write',
  'fix', 'refactor', 'add', 'scaffold', 'setup', 'prototype', 'generate', 'debug', 'port', 'migrate', 'rewrite',
  'program', 'ship', 'deploy', 'design and build', 'update', 'change', 'improve', 'optimize', 'optimise', 'test',
];

/** Nouns that name software. A verb followed first by one of these is a coding ask. */
const SOFTWARE = [
  'web app', 'webapp', 'landing page', 'web page', 'webpage', 'website', 'web site', 'mobile app', 'chrome extension',
  'browser extension', 'unit tests', 'unit test', 'test suite', 'pull request', 'rest api', 'graphql api', 'sql query',
  'database schema', 'api endpoint', 'command line tool', 'command-line tool', 'html page', 'single page app',
  'app', 'apps', 'application', 'page', 'site', 'script', 'scripts', 'component', 'components', 'api', 'endpoint',
  'endpoints', 'bug', 'bugs', 'function', 'functions', 'cli', 'game', 'tool', 'extension', 'plugin', 'bot', 'backend',
  'frontend', 'ui', 'dashboard', 'feature', 'features', 'tests', 'html', 'css', 'react', 'vue', 'svelte', 'python',
  'typescript', 'javascript', 'node', 'regex', 'calculator', 'todo', 'to-do', 'crash', 'repo', 'repository',
  'codebase', 'code', 'migration', 'widget', 'checker', 'converter', 'parser', 'scraper', 'crawler', 'workflow file',
  'dockerfile', 'makefile', 'login', 'signup', 'sign-up', 'microservice',
];

/** Nouns that name content or plans, not software. A verb followed first by one of these is not a coding ask. */
const CONTENT = [
  'blog post', 'press release', 'social post', 'cover letter', 'marketing plan', 'business plan', 'job description',
  'product description', 'linkedin post', 'tweet', 'tweets', 'thread', 'post', 'posts', 'caption', 'captions', 'email',
  'emails', 'essay', 'poem', 'story', 'newsletter', 'article', 'articles', 'summary', 'report', 'slogan', 'tagline',
  'logo', 'pitch', 'deck', 'presentation', 'outline', 'speech', 'letter', 'bio', 'headline', 'headlines', 'copy',
  'strategy', 'plan', 'list', 'recipe', 'joke', 'song', 'lyrics', 'diagram', 'whiteboard', 'image', 'picture',
  'video', 'script for a video', 'video script', 'ugc script', 'ad', 'ads', 'campaign', 'review', 'translation',
];

/** Openers that turn the message into a question about something, not a request to build it. */
const QUESTION = /^(?:what|what's|whats|why|who|whom|whose|when|where|which|is|are|does|do|did|should|would|explain|define|describe|tell me about|how (?:do|does|did|can|could|would|should|is|are)(?: i| you| we| one)?\b)/;

/** Openers that keep a request a request ("can you build…", "please fix…"). Stripped before the verb test. */
const POLITE = /^(?:(?:hey|hi|hello|ok|okay|so|now|and)[,!.]?\s+)*(?:(?:can|could|would|will) you(?: please)?|please|pls|i (?:want|need|would like) (?:you )?to|i(?:'d| would) like (?:you )?to|i want|i need|help me(?: to)?|let's|lets|let us|go ahead and|try to|quickly)\s+/;

/** "I need a landing page…": a need for a thing with no verb. The first noun decides, as after a verb. */
const NEED = /^(?:i|we) (?:need|want)\s+(?:a|an|some|new|my|our)\b/;

/** Breakage phrases that ask for a fix without a verb ("the login page is broken"). */
const BROKEN = /\b(?:is broken|are broken|crashes|crashing|crashed|throws|is throwing|doesn't work|does not work|isn't working|is not working|not working|fails to (?:load|build|compile|start)|won't (?:load|build|compile|start)|stack trace|traceback|segfault|500 error|404 error)\b/;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (words: readonly string[]): RegExp => new RegExp(`\\b(?:${[...words].sort((a, b) => b.length - a.length).map(escape).join('|')})\\b`, 'g');
const VERB_RE = new RegExp(`^(?:${[...VERBS].sort((a, b) => b.length - a.length).map(escape).join('|')})\\b`);
const SOFTWARE_RE = wordRe(SOFTWARE);
const CONTENT_RE = wordRe(CONTENT);

/** The first noun of either list after `from`, and which list it came from. */
function firstNoun(text: string, from: number): { kind: 'software' | 'content'; word: string } | null {
  const tail = text.slice(from);
  SOFTWARE_RE.lastIndex = 0;
  CONTENT_RE.lastIndex = 0;
  const s = SOFTWARE_RE.exec(tail);
  const c = CONTENT_RE.exec(tail);
  if (!s && !c) return null;
  if (s && (!c || s.index < c.index || (s.index === c.index && s[0].length >= c[0].length))) return { kind: 'software', word: s[0] };
  return { kind: 'content', word: c![0] };
}

/** Normalize a message for the rule: lower case, the first line or sentence group, no markdown or code fences. */
function normalize(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/‹[^›]*›/g, ' ') // a skill or release marker
    .replace(/[*_`#>]/g, ' ')
    .replace(/^\s*@[\w.-]+[,:]?\s+/, '') // a leading @mention addresses the agent, it is not the ask
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 600);
}

/**
 * Is this a clear request to build, change or fix software?
 *
 * Hit: a build verb opens the request (after a polite opener such as "can you" or "please"), and the
 * first noun the verb works on is a software noun. A breakage phrase about a software noun also hits.
 * Miss: a question, a content ask ("write a blog post about our app"), or no software noun.
 */
export function buildRule(body: string): BuildRuleHit {
  const text = normalize(body);
  if (!text) return { hit: false };
  if (QUESTION.test(text) && !/^(?:can|could|would|will) you\b/.test(text)) return { hit: false };
  const ask = text.replace(POLITE, '');
  const verb = VERB_RE.exec(ask);
  if (verb) {
    const noun = firstNoun(ask, verb[0].length);
    if (noun?.kind === 'software') return { hit: true, verb: verb[0], noun: noun.word };
    return { hit: false };
  }
  if (NEED.test(text)) {
    const noun = firstNoun(text, 0);
    if (noun?.kind === 'software') return { hit: true, verb: 'build', noun: noun.word };
    return { hit: false };
  }
  if (BROKEN.test(text)) {
    const noun = firstNoun(text, 0);
    if (noun?.kind === 'software') return { hit: true, verb: 'fix', noun: noun.word };
  }
  return { hit: false };
}

/** A short kebab-case name for an ask: the scratch directory and the branch. At most 40 characters. */
export function intakeSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !['a', 'an', 'the', 'that', 'which', 'to', 'for', 'of', 'and', 'with', 'please', 'can', 'you', 'me', 'my', 'i'].includes(w))
    .slice(0, 6)
    .join('-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'scratch';
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Repository names that are ordinary words too: they match only as "org/name", never alone. */
const GENERIC_REPO_NAMES = new Set(['app', 'apps', 'web', 'site', 'website', 'api', 'docs', 'frontend', 'backend', 'server', 'client', 'ui', 'mobile', 'core', 'main', 'test', 'tests', 'demo', 'landing', 'blog', 'home']);

/** Does the message name this repository ("fix the login in flowe-app", "in acme/web")? Never under 3 characters. */
export function namesRepo(body: string, repoName: string): boolean {
  const text = body.toLowerCase();
  const full = repoName.toLowerCase();
  const word = (w: string) => new RegExp(`(?:^|[^\\w-])${escapeRe(w)}(?:$|[^\\w-])`).test(text);
  if (full.includes('/') && word(full)) return true;
  const short = full.split('/').pop() ?? '';
  if (short.length < 3 || GENERIC_REPO_NAMES.has(short)) return false;
  return word(short);
}

/** Verbs that make a NEW thing. With no reference to existing code, the ask is greenfield. */
const NEW_VERBS = ['design and build', 'put together', 'spin up', 'set up', 'build', 'create', 'make', 'write', 'code', 'develop', 'implement', 'scaffold', 'prototype', 'generate', 'program'];
const NEW_VERB_RE = new RegExp(`^(?:${NEW_VERBS.map(escapeRe).join('|')})\\b`);

/** Words that point at code that already exists in the project ("our app", "the login form", "this code"). */
const EXISTING = /\b(?:our|ours|existing|current|currently|this|these|those|my (?:app|site|website|repo|repository|project|code|codebase|page))\b|\bthe (?:app|site|website|repo|repository|codebase|project|page|dashboard|login|signup|api|backend|frontend|form|server|header|footer|homepage|home page|landing page|readme|tests?|build|bug|function|component|module|class|code|navbar|nav|sidebar|settings|checkout|database|schema|endpoint|pipeline|ci|parser|helpers|utils|client|service|tests)\b|\b(?:for|to|into|on) the\b/;

/**
 * Is this a request for a NEW standalone thing: build, create, make or write a new app, page, script,
 * game or tool, with no reference to code that already exists? A greenfield ask gets a SCRATCH
 * workspace even when the project has repositories (George, 2026-11-06). Changing existing project
 * code ("fix the login form", "add dark mode to our app") is not greenfield.
 */
export function newBuildAsk(body: string): boolean {
  const text = normalize(body);
  if (!text || EXISTING.test(text)) return false;
  if (NEED.test(text)) return firstNoun(text, 0)?.kind === 'software';
  const ask = text.replace(POLITE, '');
  // a new-thing verb, and the first thing it makes is no content ("write a blog post" is not a build)
  const verb = NEW_VERB_RE.exec(ask);
  return !!verb && firstNoun(ask, verb[0].length)?.kind !== 'content';
}

/** A diagram, whiteboard or flowchart to draw. It is never coding, even when it is about the code. */
const DIAGRAM = /\b(?:diagrams?|whiteboards?|flow ?charts?|mind ?maps?)\b/;
export function diagramAsk(body: string): boolean {
  return DIAGRAM.test(normalize(body));
}

/** Verbs that work on existing code: with no named repository, they mean the project's primary one. */
export const CHANGE_VERBS: ReadonlySet<string> = new Set(['fix', 'debug', 'refactor', 'update', 'change', 'improve', 'optimize', 'optimise', 'test', 'migrate', 'port', 'rewrite', 'add']);

export interface IntakeRuleRepo { id: string; name: string; primary?: boolean }

export interface IntakeRuleDecision { kind: 'coding'; workspace: 'scratch' | 'repo'; repoId?: string }

/**
 * The whole decision of the rule, as intake applies it when the starter brain cannot answer:
 * null on a miss, else coding with a workspace. The repository is one the message names, else the
 * primary one for a change to existing code ("fix", "refactor", "add"...), else a scratch workspace
 * (a new standalone thing is always scratch, newBuildAsk).
 */
export function intakeRule(text: string, opts: { repos?: readonly IntakeRuleRepo[] } = {}): IntakeRuleDecision | null {
  const rule = buildRule(text);
  if (!rule.hit) return null;
  const repos = opts.repos ?? [];
  const named = repos.find((r) => namesRepo(text, r.name));
  const primary = repos.find((r) => r.primary) ?? repos[0];
  const pick = named ?? (CHANGE_VERBS.has(rule.verb ?? '') && !newBuildAsk(text) ? primary : undefined);
  return pick ? { kind: 'coding', workspace: 'repo', repoId: pick.id } : { kind: 'coding', workspace: 'scratch' };
}
