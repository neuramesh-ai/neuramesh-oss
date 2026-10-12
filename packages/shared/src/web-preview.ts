/** Explicit, portable reply cards. Ordinary links stay links; no URL is fetched on render. */
export interface WebPreview { url: string; title: string; description?: string }

export function webPreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function parseWebPreview(json: string): WebPreview | null {
  if (json.length > 8192) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const url = webPreviewUrl(v.url);
    if (!url || (v.title !== undefined && (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 120))) return null;
    if (v.description !== undefined && (typeof v.description !== 'string' || v.description.length > 240)) return null;
    return { url, title: typeof v.title === 'string' ? v.title.trim() : 'Web preview', ...(typeof v.description === 'string' && v.description.trim() ? { description: v.description.trim() } : {}) };
  } catch { return null; }
}

export const WEB_PREVIEW_PROMPT = `When handing the user a website or app preview to inspect, you can render an inline Web preview card in your reply using a fenced nmpreview JSON block:
\`\`\`nmpreview
{"url":"https://example.com/preview","title":"App preview","description":"Optional short description of what to try"}
\`\`\`
Use only an actual URL supplied by the user or established by tool output; never invent a port, deployment, or running server. This renders a link card with Open in NeuraMesh browser and external browser actions; it does not start a server, deploy, or verify availability. Keep ordinary references as Markdown links. Do not label a preview live or tested without evidence. Localhost URLs work on the viewing device only. Put the card next to the relevant explanation, with a short title (120 characters max), optional description (240 characters max), and an absolute http(s) URL without credentials. Do not wrap the card in another code block.`;
