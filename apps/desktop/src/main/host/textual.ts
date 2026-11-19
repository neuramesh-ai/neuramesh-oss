const TEXTUAL_EXT = /\.(md|markdown|txt|text|json|jsonc|ya?ml|toml|csv|tsv|log|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|cc|cs|php|sh|bash|zsh|sql|html?|css|scss|xml|svg|env|ini|cfg|conf|dockerfile|diff|patch)$/i;
export function isTextual(mime: string, name: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || TEXTUAL_EXT.test(name);
}
