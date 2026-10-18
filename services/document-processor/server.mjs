import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createProcessor, validateRequest } from './processor.mjs';
import { releasePolicyFromEnv } from './release-authorization.mjs';

export function createServer({ token, processDocument, concurrency = 1 }) {
  if (!token || token.length < 32) throw new Error('DOCUMENT_PROCESSOR_TOKEN must be at least 32 characters');
  let active = 0;
  return http.createServer(async (req, res) => {
    const send = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); } };
    if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'ok' });
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(401, { error: 'Unauthorized' });
    if (req.method !== 'POST' || req.url !== '/v1/extract') return send(404, { error: 'Not found' });
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON required' });
    if (active >= concurrency) return send(429, { error: 'Processor busy; retry later' });
    active++;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 20 * 1024 * 1024) { send(413, { error: 'Request exceeds 20 MB; split the submission' }); return; }
        chunks.push(chunk);
      }
      let input;
      try { input = validateRequest(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { return send(400, { error: 'Invalid processing request' }); }
      const result = await processDocument(input);
      send(200, result);
    } catch {
      // Provider messages can contain carrier data. Never log or return them.
      send(422, { error: 'Document processing failed; check format, model availability, and processing limits' });
    } finally { active--; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const processDocument = createProcessor({
    profilesDir: process.env.PROFILES_DIR || new URL('./profiles', import.meta.url).pathname,
    modelUrl: process.env.MODEL_BASE_URL, model: process.env.MODEL_NAME, modelToken: process.env.MODEL_TOKEN,
    releasePolicy: await releasePolicyFromEnv(),
  });
  const server = createServer({ token: process.env.DOCUMENT_PROCESSOR_TOKEN, processDocument });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
