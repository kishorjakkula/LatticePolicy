import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareDocument } from './documents.mjs';

// A tiny synthetic PDF fixture; no carrier files or external image generator.
function fixturePdf() {
  const stream = 'BT /F1 24 Tf 40 650 Td (Named Insured: Synthetic Sample Company) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('real offline Poppler and Tesseract extract a synthetic PDF and scan', { skip: process.env.RUN_OCR_SMOKE !== '1' }, async () => {
  const pdf = fixturePdf();
  const result = await prepareDocument({ id: 'pdf', fileName: 'fixture.pdf', mediaType: 'application/pdf', textLines: [], dataBase64: pdf.toString('base64') });
  assert.match(result.pages[0].lines.join(' '), /Synthetic Sample Company/);
  const directory = await mkdtemp(path.join(tmpdir(), 'lattice-ocr-smoke-'));
  try {
    const file = path.join(directory, 'fixture.pdf');
    await writeFile(file, pdf);
    await promisify(execFile)('pdftoppm', ['-scale-to', '1800', '-png', '-singlefile', file, path.join(directory, 'scan')], { timeout: 30000 });
    const image = await readFile(path.join(directory, 'scan.png'));
    const scan = await prepareDocument({ id: 'scan', fileName: 'scan.png', mediaType: 'image/png', textLines: [], dataBase64: image.toString('base64') });
    assert.match(scan.pages[0].lines.join(' '), /Synthetic Sample Company/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
