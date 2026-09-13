// Share tooling for the benchmarks page — a self-contained, branded SVG "card" per role that
// exports to PNG entirely in the browser (SVG → canvas → blob, no dependency, no external fonts
// so the canvas never taints). Copy-to-clipboard, download, and an X (Twitter) intent.
import { DATA, MODELS, fmtPrimary, type BenchRole } from './benchmarks';

const CARD = { w: 1200, h: 630 };
// Fixed branded palette (a share image should look the same regardless of the viewer's theme).
const COL = { paper: '#f7ece0', surface: '#fffaf2', ink: '#2c2018', muted: '#8a7969', faint: '#a8967f', line: '#e8d9c6', accent: '#ec5a32' };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const pcolor = (p: string): string => (p === 'anthropic' ? '#ec5a32' : p === 'openai' ? '#7d6cf0' : '#4f80c4');
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A branded 1200×630 (X card ratio) SVG string for one role's leaderboard. */
export function shareCardSvg(role: BenchRole): string {
  const rows = role.leaderboard.slice(0, 6);
  const x0 = 400, x1 = CARD.w - 150, rowH = 54, top = 250;
  const bars = rows
    .map((r, i) => {
      const m = MODELS[r.model];
      const y = top + i * rowH;
      const bw = Math.max(6, ((x1 - x0) * r.quality) / 100);
      const col = pcolor(m?.provider ?? 'anthropic');
      const win = r.model === role.winner;
      return `
      <text x="64" y="${y + 7}" font-family="${FONT}" font-size="20" font-weight="700" fill="${COL.faint}">${i + 1}</text>
      <circle cx="100" cy="${y}" r="7" fill="${col}"/>
      <text x="120" y="${y + 7}" font-family="${FONT}" font-size="22" font-weight="${win ? 800 : 600}" fill="${COL.ink}">${esc(m?.label ?? r.model)}${win ? '  ★' : ''}</text>
      <rect x="${x0}" y="${y - 13}" width="${x1 - x0}" height="26" rx="7" fill="${COL.line}"/>
      <rect x="${x0}" y="${y - 13}" width="${bw}" height="26" rx="7" fill="${col}"/>
      <text x="${CARD.w - 60}" y="${y + 7}" text-anchor="end" font-family="${FONT}" font-size="24" font-weight="800" fill="${COL.ink}">${esc(fmtPrimary(r, role))}</text>`;
    })
    .join('');
  const winner = esc(MODELS[role.winner]?.label ?? role.winner);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.w}" height="${CARD.h}" viewBox="0 0 ${CARD.w} ${CARD.h}">
  <rect width="${CARD.w}" height="${CARD.h}" fill="${COL.paper}"/>
  <rect x="10" y="10" width="${CARD.w - 20}" height="${CARD.h - 20}" rx="26" fill="${COL.surface}" stroke="${COL.line}" stroke-width="2"/>
  <rect x="60" y="54" width="42" height="42" rx="12" fill="${COL.accent}"/>
  <path d="M70 68 c8 0 11 20 22 20 M70 82 c8 0 11 -20 22 -20" stroke="#fff6f1" stroke-width="3.2" stroke-linecap="round" fill="none"/>
  <text x="114" y="84" font-family="${FONT}" font-size="27" font-weight="800" fill="${COL.ink}">NeuraMesh</text>
  <text x="${CARD.w - 60}" y="74" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="700" letter-spacing="2" fill="${COL.accent}">MODEL BENCHMARKS</text>
  <text x="60" y="164" font-family="${FONT}" font-size="42" font-weight="800" fill="${COL.ink}">Best model for ${esc(role.label.toLowerCase())}</text>
  <text x="60" y="200" font-family="${FONT}" font-size="18" fill="${COL.muted}">Private, held-out tasks · ${DATA.meta.runsPerTask} runs · ${esc(role.metricLabel)} · 95% CI · ${DATA.models.length} models · measured ${esc(DATA.meta.generatedAt)}</text>
  ${bars}
  <line x1="60" y1="566" x2="${CARD.w - 60}" y2="566" stroke="${COL.line}" stroke-width="1.5"/>
  <text x="60" y="598" font-family="${FONT}" font-size="18" font-weight="700" fill="${COL.accent}">neuramesh.app/model-benchmarks</text>
  <text x="${CARD.w - 60}" y="598" text-anchor="end" font-family="${FONT}" font-size="18" fill="${COL.muted}">Winner · ${winner}</text>
</svg>`;
}

async function cardBlob(role: BenchRole, scale = 2): Promise<Blob> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(shareCardSvg(role));
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('share card render failed'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = CARD.w * scale;
  canvas.height = CARD.h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

export async function downloadCard(role: BenchRole): Promise<void> {
  const url = URL.createObjectURL(await cardBlob(role));
  const a = document.createElement('a');
  a.href = url;
  a.download = `neuramesh-benchmarks-${role.id}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Copy the card PNG to the clipboard; returns false if the browser blocks it (caller can fall back). */
export async function copyCard(role: BenchRole): Promise<boolean> {
  try {
    const blob = await cardBlob(role);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export function shareToX(role: BenchRole): void {
  const winner = MODELS[role.winner]?.label ?? role.winner;
  const text = `We benchmarked ${DATA.models.length} LLMs on real ${role.label.toLowerCase()} tasks — ${winner} takes the seat. Private held-out tasks, ${DATA.meta.runsPerTask} runs, cost + quality:`;
  const url = 'https://neuramesh.app/model-benchmarks';
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener,noreferrer');
}
