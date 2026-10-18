import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const MAX_TEXT = 120000;
function linesOf(text) {
  if (text.length > MAX_TEXT) throw new Error('Document text exceeds processing limit; split the document');
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

/** OCR commands are local, bounded subprocesses. No shell or remote converter. */
export async function prepareDocument(document, { run = exec, signal } = {}) {
  if (document.textLines.length) {
    if (document.textLines.join('\n').length > MAX_TEXT) throw new Error('Document text exceeds processing limit');
    return { id: document.id, fileName: document.fileName, pages: [{ page: null, lines: document.textLines }] };
  }
  if (!document.dataBase64 || !['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(document.mediaType)) throw new Error('No readable text; unsupported or damaged document');
  const bytes = Buffer.from(document.dataBase64, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Invalid document size');
  const directory = await mkdtemp(path.join(tmpdir(), 'lattice-ocr-'));
  const options = { timeout: 60000, signal, maxBuffer: 512 * 1024, env: { PATH: process.env.PATH, OMP_THREAD_LIMIT: '1', HOME: directory } };
  try {
    const file = path.join(directory, document.mediaType === 'application/pdf' ? 'input.pdf' : 'input.image');
    await writeFile(file, bytes, { mode: 0o600 });
    if (document.mediaType === 'application/pdf') {
      const { stdout: info } = await run('pdfinfo', [file], options);
      const count = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
      if (!count || count > 8) throw new Error('PDF must contain 1-8 pages; split larger documents');
      const { stdout: text } = await run('pdftotext', ['-layout', file, '-'], options);
      const pages = text.split('\f').slice(0, count);
      if (text.length > MAX_TEXT) throw new Error('Document text exceeds processing limit');
      if (text.replace(/\s/g, '').length > 20 && pages.length === count && pages.every(page => page.trim())) {
        return { id: document.id, fileName: document.fileName, pages: pages.map((page, index) => ({ page: index + 1, lines: linesOf(page) })) };
      }
      await run('pdftoppm', ['-scale-to', '1800', '-png', file, path.join(directory, 'page')], options);
      const images = (await readdir(directory)).filter(name => /^page-\d+\.png$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (images.length !== count) throw new Error('Could not render every PDF page');
      const extracted = [];
      for (const [index, image] of images.entries()) {
        const { stdout } = await run('tesseract', [path.join(directory, image), 'stdout', '-l', 'eng'], options);
        extracted.push({ page: index + 1, lines: linesOf(stdout) });
      }
      if (JSON.stringify(extracted).length > MAX_TEXT) throw new Error('Document text exceeds processing limit');
      if (!extracted.some(page => page.lines.length)) throw new Error('No legible text found');
      return { id: document.id, fileName: document.fileName, pages: extracted };
    }
    const { stdout } = await run('tesseract', [file, 'stdout', '-l', 'eng'], options);
    const lines = linesOf(stdout);
    if (!lines.length) throw new Error('No legible text found');
    return { id: document.id, fileName: document.fileName, pages: [{ page: 1, lines }] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
