import crypto from 'crypto'

const CUSTOMER_DATA_KEY = process.env.CUSTOMER_DATA_KEY || process.env.JWT_SECRET || 'lattice-policy-customer-dev-key'

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest()
}

const ENCRYPTION_KEY = deriveKey(CUSTOMER_DATA_KEY)

export function normalizeSensitiveValue(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function hashSensitiveValue(value: unknown): string | null {
  const normalized = normalizeSensitiveValue(value)
  if (!normalized) return null
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export function encryptSensitiveValue(value: unknown): string | null {
  const raw = String(value ?? '')
  if (!raw.trim()) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`
}

export function decryptSensitiveValue(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const pieces = raw.split('.')
  if (pieces.length !== 3) return null
  try {
    const iv = Buffer.from(pieces[0], 'base64')
    const tag = Buffer.from(pieces[1], 'base64')
    const payload = Buffer.from(pieces[2], 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    return null
  }
}
