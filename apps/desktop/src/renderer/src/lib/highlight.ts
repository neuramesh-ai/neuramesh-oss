// Zero-dep syntax highlighter for the editor pane — extracted from App.tsx (track A1).

// ── tiny zero-dep syntax highlighter for the editor pane ─────────────────────
// One combined regex per language (rules ordered, no capturing groups inside a rule);
// emitted spans never cross a newline so the output is safe to split into lines.
// Colors ride the theme role tokens (.tk-* in tokens.css), so all four themes adapt.
export const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
export const wrapTok = (txt: string, cls: string) => txt.split('\n').map((seg) => (seg ? `<span class="${cls}">${escHtml(seg)}</span>` : '')).join('\n');
export type HlLang = { flags: string; rules: Array<[string, string]> };
export const HL_JS: HlLang = {
  flags: 'g',
  rules: [
    ['\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*', 'tk-c'],
    ['`(?:[^`\\\\]|\\\\[\\s\\S])*`|\'(?:[^\'\\\\\\n]|\\\\.)*\'|"(?:[^"\\\\\\n]|\\\\.)*"', 'tk-s'],
    ['\\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|implements|interface|type|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false|this|super|yield|static|readonly|enum|namespace|declare|as|satisfies|void|delete|abstract|keyof|never|unknown|any|string|number|boolean|object)\\b', 'tk-k'],
    ['\\b0[xXbBoO][\\da-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?\\b', 'tk-n'],
  ],
};
export const HL_LANGS: Record<string, HlLang> = {
  ts: HL_JS, tsx: HL_JS, js: HL_JS, jsx: HL_JS, mjs: HL_JS, cjs: HL_JS, mts: HL_JS, cts: HL_JS,
  json: { flags: 'g', rules: [
    ['"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)', 'tk-p'],
    ['"(?:[^"\\\\]|\\\\.)*"', 'tk-s'],
    ['\\b(?:true|false|null)\\b', 'tk-k'],
    ['-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b', 'tk-n'],
  ] },
  css: { flags: 'g', rules: [
    ['\\/\\*[\\s\\S]*?\\*\\/', 'tk-c'],
    ['\'[^\'\\n]*\'|"[^"\\n]*"', 'tk-s'],
    ['@[\\w-]+', 'tk-k'],
    ['#[\\da-fA-F]{3,8}\\b', 'tk-n'],
    ['(?:--)?[a-zA-Z][\\w-]*(?=\\s*:)', 'tk-p'],
    ['\\b\\d[\\w.%]*', 'tk-n'],
  ] },
  md: { flags: 'gm', rules: [
    ['```[\\s\\S]*?```', 'tk-s'],
    ['`[^`\\n]+`', 'tk-s'],
    ['^#{1,6}[^\\n]*', 'tk-t'],
    ['^>[^\\n]*', 'tk-c'],
    ['\\*\\*[^*\\n]+\\*\\*', 'tk-k'],
    ['\\[[^\\]\\n]*\\]\\([^)\\n]*\\)', 'tk-p'],
  ] },
  sh: { flags: 'gm', rules: [
    ['\'[^\']*\'|"(?:[^"\\\\]|\\\\.)*"', 'tk-s'],
    ['#[^\\n]*', 'tk-c'],
    ['\\$\\{[^}\\n]*\\}|\\$\\w+', 'tk-v'],
    ['\\b(?:if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|export|local|source|echo|cd|set|shift|exit|trap)\\b', 'tk-k'],
  ] },
  yaml: { flags: 'gm', rules: [
    ['\'[^\'\\n]*\'|"[^"\\n]*"', 'tk-s'],
    ['#[^\\n]*', 'tk-c'],
    ['[\\w.-]+(?=:(?:[ \\t]|$))', 'tk-p'],
    ['\\b(?:true|false|null|yes|no)\\b', 'tk-k'],
    ['\\b\\d+(?:\\.\\d+)?\\b', 'tk-n'],
  ] },
  html: { flags: 'g', rules: [
    ['<!--[\\s\\S]*?-->', 'tk-c'],
    ['"[^"]*"|\'[^\']*\'', 'tk-s'],
    ['<\\/?[\\w-]+|\\/?>', 'tk-t'],
  ] },
  sql: { flags: 'gi', rules: [
    ['--[^\\n]*', 'tk-c'],
    ['\'(?:[^\']|\'\')*\'', 'tk-s'],
    ['\\b(?:select|from|where|insert|into|values|update|set|delete|create|drop|alter|table|index|view|join|left|right|inner|outer|on|as|and|or|not|null|order|by|group|having|limit|offset|distinct|union|all|exists|in|like|between|is|primary|key|foreign|references|default|unique|constraint|begin|commit|rollback|returning|with)\\b', 'tk-k'],
    ['\\b\\d+(?:\\.\\d+)?\\b', 'tk-n'],
  ] },
};
HL_LANGS['bash'] = HL_LANGS['sh']!; HL_LANGS['zsh'] = HL_LANGS['sh']!;
HL_LANGS['yml'] = HL_LANGS['yaml']!; HL_LANGS['markdown'] = HL_LANGS['md']!;
HL_LANGS['htm'] = HL_LANGS['html']!; HL_LANGS['svg'] = HL_LANGS['html']!; HL_LANGS['xml'] = HL_LANGS['html']!;
export const hlRegexCache = new Map<string, RegExp>();
export function highlightCode(src: string, path: string): string {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const lang = HL_LANGS[ext];
  if (!lang) return escHtml(src);
  let re = hlRegexCache.get(ext);
  if (!re) { re = new RegExp(lang.rules.map((r) => `(${r[0]})`).join('|'), lang.flags); hlRegexCache.set(ext, re); }
  re.lastIndex = 0;
  let out = '', last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out += escHtml(src.slice(last, m.index));
    const gi = m.slice(1).findIndex((g) => g !== undefined);
    out += wrapTok(m[0], lang.rules[gi]?.[1] ?? 'tk-s');
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // never loop on an empty match
  }
  return out + escHtml(src.slice(last));
}
