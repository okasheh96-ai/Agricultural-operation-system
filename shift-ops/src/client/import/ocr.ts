// On-device OCR (Tesseract, Arabic + English) with engine and language data served from this app, so no
// photo leaves the phone for reading. Output is a Grid whose cells keep their image region and confidence.
import type { Cell, Grid } from './parse';
import { colLetter } from './parse';
import { normalizeDigits } from '../../shared/num';

export async function toDecodableImage(file: File): Promise<Blob> {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) return file;
  try {
    // Safari on iPhone decodes HEIC natively
    const bmp = await createImageBitmap(file);
    bmp.close();
    return file;
  } catch {
    const heic2any = (await import('heic2any')).default;
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return Array.isArray(out) ? out[0] : out;
  }
}

export async function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const r = { w: bmp.width, h: bmp.height };
  bmp.close();
  return r;
}

interface Word { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface Line { words: Word[]; bbox: { x0: number; y0: number; x1: number; y1: number } }

export async function ocrImage(blob: Blob, langs: string, onProgress?: (p: number) => void): Promise<{ grid: Grid; lines: number; width: number; height: number }> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(langs.split('+'), 1, {
    workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang', gzip: true, workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  });
  try {
    const { w, h } = await imageSize(blob);
    const res = await worker.recognize(blob, {}, { blocks: true });
    const data = res.data as unknown as { blocks?: { paragraphs: { lines: Line[] }[] }[] };
    const lines: Line[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    return { grid: linesToGrid(lines), lines: lines.length, width: w, height: h };
  } finally {
    await worker.terminate();
  }
}

/** Split each text line into cells at wide gaps, then align cells to columns across lines by position. */
export function linesToGrid(lines: Line[]): Grid {
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rowsCells: { x0: number; x1: number; words: Word[] }[][] = sorted.map((ln) => {
    const ws = [...ln.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const hs = ws.map((w) => w.bbox.y1 - w.bbox.y0);
    const gap = Math.max(12, (hs.sort((a, b) => a - b)[Math.floor(hs.length / 2)] ?? 20) * 1.2);
    const cells: { x0: number; x1: number; words: Word[] }[] = [];
    for (const w of ws) {
      const last = cells[cells.length - 1];
      if (last && w.bbox.x0 - last.x1 < gap) { last.words.push(w); last.x1 = Math.max(last.x1, w.bbox.x1); }
      else cells.push({ x0: w.bbox.x0, x1: w.bbox.x1, words: [w] });
    }
    return cells;
  });
  // column anchors from the line with the most cells (usually the header)
  const anchorRow = rowsCells.reduce((m, r) => (r.length > m.length ? r : m), [] as { x0: number; x1: number }[]);
  const rtl = sorted.flatMap((l) => l.words).filter((w) => /[؀-ۿ]/.test(w.text)).length > sorted.flatMap((l) => l.words).length / 2;
  let anchors = anchorRow.map((c) => (c.x0 + c.x1) / 2).sort((a, b) => a - b);
  if (rtl) anchors = anchors.reverse();
  const rows: (Cell | null)[][] = rowsCells.map((cells, ri) => {
    const out: (Cell | null)[] = anchors.map(() => null);
    for (const c of cells) {
      const mid = (c.x0 + c.x1) / 2;
      let best = 0;
      anchors.forEach((a, i) => { if (Math.abs(a - mid) < Math.abs(anchors[best] - mid)) best = i; });
      const ordered = rtl ? [...c.words].reverse() : c.words;
      const text = normalizeDigits(ordered.map((w) => w.text).join(' ')).trim();
      const conf = Math.min(...c.words.map((w) => w.confidence));
      const bbox: [number, number, number, number] = [c.x0, Math.min(...c.words.map((w) => w.bbox.y0)), c.x1, Math.max(...c.words.map((w) => w.bbox.y1))];
      const readable = /[\p{L}\p{N}]/u.test(text) && conf >= 30;
      const prev = out[best];
      const cell: Cell = { text: readable ? text : '', conf: readable ? conf : 0, bbox, ref: `${colLetter(best)}${ri + 1}` };
      out[best] = prev ? { ...prev, text: `${prev.text} ${cell.text}`.trim(), conf: Math.min(prev.conf ?? 100, cell.conf ?? 100) } : cell;
    }
    return out;
  });
  return { name: 'photo', rows, merged: [], kind: 'image' };
}
