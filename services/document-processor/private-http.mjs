import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPrivateAddress(address) {
  if (address === '::1') return true;
  // Reject mapped IPv6 and link-local/metadata addresses, not just public IPs.
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Pin the validated DNS answer on the connection; never follow redirects. */
export async function privateJson(url, body, { token = '', timeoutMs = 180000, maxBytes = 2 * 1024 * 1024 } = {}) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) throw new Error('Invalid private endpoint');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const answers = await Promise.race([
      lookup(host, { all: true }),
      new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Private request timed out')), { once: true })),
    ]);
    if (!answers.length || answers.some(answer => !isPrivateAddress(answer.address))) throw new Error('Endpoint must resolve only to private or loopback addresses');
    const data = JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const request = (target.protocol === 'https:' ? https : http).request(target, {
        method: 'POST', signal: controller.signal,
        lookup: (_host, options, callback) => options.all ? callback(null, [answers[0]]) : callback(null, answers[0].address, answers[0].family),
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      }, response => {
        const chunks = [];
        let bytes = 0;
        response.on('error', reject);
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > maxBytes) { response.destroy(new Error('Private response too large')); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`Private service returned HTTP ${response.statusCode}`));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Private service returned invalid JSON')); }
        });
      });
      request.on('error', reject);
      request.end(data);
    });
  } finally { clearTimeout(timer); }
}
