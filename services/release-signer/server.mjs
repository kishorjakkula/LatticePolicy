import { readFile } from 'node:fs/promises'
import { createServer, createSigner } from './signer.mjs'

const signRequest = await createSigner({
  privateKeyPem: await readFile(process.env.SIGNER_KEY_FILE || '/run/secrets/release-key.pem', 'utf8'),
  token: process.env.SIGNER_TOKEN,
  logFile: process.env.SIGNER_LOG_FILE || '/var/log/release-signer/signatures.jsonl',
  tenantId: process.env.CARRIER_TENANT_ID || '',
})
const server = createServer({ token: process.env.SIGNER_TOKEN, signRequest })
server.requestTimeout = 10000
server.headersTimeout = 5000
server.listen(Number(process.env.PORT || 8090), '0.0.0.0')
process.on('SIGTERM', () => server.close())
