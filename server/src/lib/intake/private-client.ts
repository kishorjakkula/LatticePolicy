import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export function privateAddress(address: string): boolean {
  if (address === '::1') return true
  if (isIP(address) !== 4) return false
  const [a, b] = address.split('.').map(Number)
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/** A private-only, DNS-pinned connection with a deadline covering the body. */
export async function callDocumentProcessor(url: string, token: string, body: unknown, timeoutMs = 250000): Promise<any> {
  const target = new URL(url)
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) throw new Error('Invalid document processor URL')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const host = target.hostname.replace(/^\[|\]$/g, '')
    const answers = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Document processor timed out')), { once: true })),
    ])
    if (!answers.length || answers.some(answer => !privateAddress(answer.address))) throw new Error('Document processor must resolve only to private or loopback addresses')
    const data = JSON.stringify(body)
    if (Buffer.byteLength(data) > 20 * 1024 * 1024) throw new Error('Processing request exceeds 20 MB; split the submission')
    return await new Promise((resolve, reject) => {
      const request = (target.protocol === 'https:' ? https : http).request(target, {
        method: 'POST', signal: controller.signal,
        lookup: ((_host: string, options: any, callback: any) => options.all ? callback(null, [answers[0]]) : callback(null, answers[0].address, answers[0].family)) as any,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: `Bearer ${token}` },
      }, response => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('error', reject)
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 4 * 1024 * 1024) { response.destroy(new Error('Document processor response too large')); return }
          chunks.push(chunk)
        })
        response.on('end', () => {
          // Never expose provider error bodies, which may echo carrier documents.
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`Document processor returned HTTP ${response.statusCode}`))
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('Invalid document processor response')) }
        })
      })
      request.on('error', reject)
      request.end(data)
    })
  } finally { clearTimeout(timer) }
}
