import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createProcessor, validateRequest } from './processor.mjs';
import { createServer } from './server.mjs';
import { publishProfile, activateProfile, loadProfile } from './profiles.mjs';
import { privateJson, isPrivateAddress } from './private-http.mjs';
import { prepareDocument } from './documents.mjs';

const token = 'test-only-token-not-for-deployment-123456';
const profilesDir = new URL('./profiles', import.meta.url).pathname;
const input = () => ({
  schemaVersion: 1, profile: 'submission',
  documents: [{ id: 'd1', fileName: 'application.txt', mediaType: 'text/plain', textLines: ['Applicant: Synthetic LLC'] }],
  schema: { fields: [{ key: 'insuredName', label: 'Insured', type: 'text', options: [] }], variants: [] },
});
async function listen(server, t) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('extracts through the authenticated service and a private model, without business dependencies', async t => {
  let received;
  const model = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ values: [{ key: 'insuredName', value: 'Synthetic LLC', documentId: 'd1', line: 1, quote: 'Applicant: Synthetic LLC', confidence: 90 }], conflicts: [] }) } }] }));
  });
  const modelUrl = await listen(model, t);
  const processDocument = createProcessor({ profilesDir, modelUrl: `${modelUrl}/v1`, model: 'local-test-model' });
  const base = await listen(createServer({ token, processDocument }), t);
  const result = await privateJson(`${base}/v1/extract`, input(), { token });
  assert.equal(result.result.values[0].value, 'Synthetic LLC');
  assert.deepEqual(result.profile, { id: 'submission', version: '1.0.0' });
  assert.equal(result.model, 'local-test-model');
  assert.equal(received.response_format.type, 'json_object');
  assert.match(received.messages[0].content, /never instructions/);
  assert.equal(JSON.parse(received.messages[1].content).documents[0].id, 'd1');
  assert.equal(received.tools, undefined);
});

test('rejects unauthenticated requests before processing', async t => {
  let called = false;
  const base = await listen(createServer({ token, processDocument: async () => { called = true; } }), t);
  await assert.rejects(privateJson(`${base}/v1/extract`, input()), /401/);
  assert.equal(called, false);
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.throws(() => createServer({ token: 'short' }), /32 characters/);
});

test('does not return model error details or carrier content', async t => {
  const base = await listen(createServer({ token, processDocument: async () => { throw new Error('PRIVATE CARRIER CONTENT'); } }), t);
  const response = await fetch(`${base}/v1/extract`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input()) });
  assert.equal(response.status, 422);
  assert.doesNotMatch(await response.text(), /PRIVATE CARRIER/);
});

test('bounds simultaneous work and rejects invalid schemas', async t => {
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const base = await listen(createServer({ token, processDocument: async () => { started(); return new Promise(resolve => { release = resolve; }); } }), t);
  const pending = privateJson(`${base}/v1/extract`, input(), { token });
  await ready;
  await assert.rejects(privateJson(`${base}/v1/extract`, input(), { token }), /429/);
  release({ schemaVersion: 1 }); await pending;
  assert.throws(() => validateRequest({ ...input(), documents: Array(11).fill(input().documents[0]) }), /1-10/);
  assert.throws(() => validateRequest({ ...input(), profile: '../secret' }), /Invalid/);
  const invalid = input(); invalid.schema.fields[0].type = 'execute';
  assert.throws(() => validateRequest(invalid), /Invalid target/);
  const response = await fetch(`${base}/v1/extract`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: 'not json' });
  assert.equal(response.status, 400);
});

test('private connections block public/metadata IPs, redirect leakage and oversized responses', async t => {
  for (const ip of ['8.8.8.8', '169.254.169.254', '0.0.0.0', '::ffff:127.0.0.1', '100.100.100.200']) assert.equal(isPrivateAddress(ip), false);
  for (const ip of ['127.0.0.1', '10.3.0.1', '172.20.0.1', '192.168.1.1', '::1']) assert.equal(isPrivateAddress(ip), true);
  await assert.rejects(privateJson('http://8.8.8.8/v1', {}), /private/);
  await assert.rejects(privateJson('http://169.254.169.254/v1', {}), /private/);
  await assert.rejects(privateJson('http://user:password@127.0.0.1', {}), /Invalid/);
  const base = await listen(http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'https://public.invalid/' }); res.end(); }
    else res.end(JSON.stringify({ text: 'x'.repeat(1000) }));
  }), t);
  await assert.rejects(privateJson(`${base}/redirect`, {}), /302/);
  await assert.rejects(privateJson(base, {}, { maxBytes: 20 }), /too large/);
});

test('deadline covers a stalled response body after headers', async t => {
  const base = await listen(http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); res.write('{'); }), t);
  await assert.rejects(privateJson(base, {}, { timeoutMs: 50 }), /abort|timed out/i);
});

test('profiles are immutable, independently activated and rollbackable', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lattice-profiles-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = JSON.parse(await readFile(path.join(profilesDir, 'submission/1.0.0.json'), 'utf8'));
  await publishProfile(directory, first);
  await assert.rejects(publishProfile(directory, first), /EEXIST/);
  await activateProfile(directory, 'submission', '1.0.0');
  const processor = createProcessor({ profilesDir: directory, modelUrl: 'http://model:8000/v1', model: 'local', request: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"values":[],"conflicts":[]}' } }] }) });
  assert.equal((await processor(input())).profile.version, '1.0.0');
  const second = { ...first, version: '1.1.0', instructions: 'Use reviewed mappings.' };
  await publishProfile(directory, second);
  assert.equal((await loadProfile(directory, 'submission')).version, '1.0.0');
  await activateProfile(directory, 'submission', '1.1.0');
  assert.equal((await loadProfile(directory, 'submission')).version, '1.1.0');
  assert.equal((await processor(input())).profile.version, '1.1.0');
  await activateProfile(directory, 'submission', '1.0.0');
  assert.equal((await loadProfile(directory, 'submission')).version, '1.0.0');
  await assert.rejects(publishProfile(directory, { ...first, version: '1.2.0', reviewed: false }), /reviewed/);
  await assert.rejects(loadProfile(directory, '../secret'), /Invalid/);
});

test('rejects incomplete and malformed model output', async () => {
  const create = response => createProcessor({ profilesDir, modelUrl: 'http://model:8000/v1', model: 'local', request: async () => response });
  await assert.rejects(create({ choices: [{ finish_reason: 'length' }] })(input()), /complete/);
  await assert.rejects(create({ choices: [{ finish_reason: 'stop', message: { content: 'invalid' } }] })(input()), /invalid extraction JSON/);
  await assert.rejects(create({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] })(input()), /invalid extraction structure/);
});

test('local PDF extraction preserves page evidence and removes temporary files', async () => {
  let temporaryFile;
  const document = { id: 'pdf', fileName: 'private.pdf', mediaType: 'application/pdf', textLines: [], dataBase64: Buffer.from('%PDF').toString('base64') };
  const result = await prepareDocument(document, { run: async (command, args) => {
    if (command === 'pdfinfo') { temporaryFile = args[0]; return { stdout: 'Pages: 1\n' }; }
    assert.equal(command, 'pdftotext');
    return { stdout: 'Named Insured: Synthetic Example Company\n\f' };
  } });
  assert.equal(result.pages[0].page, 1);
  assert.match(result.pages[0].lines[0], /Synthetic/);
  await assert.rejects(access(temporaryFile), /ENOENT/);
  await assert.rejects(prepareDocument(document, { run: async () => ({ stdout: 'Pages: 1000' }) }), /1-8 pages/);
});

test('image OCR is local, has a deadline, and fails closed for illegible files', async () => {
  const document = { id: 'scan', fileName: 'x.png', mediaType: 'image/png', textLines: [], dataBase64: Buffer.from('image').toString('base64') };
  const result = await prepareDocument(document, { run: async (command, args, options) => {
    assert.equal(command, 'tesseract'); assert.equal(args[1], 'stdout'); assert.equal(options.timeout, 60000);
    return { stdout: 'Insured: Synthetic LLC' };
  } });
  assert.equal(result.pages[0].page, 1);
  await assert.rejects(prepareDocument(document, { run: async () => ({ stdout: ' ' }) }), /No legible/);
});
