import { createHmac, randomBytes } from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const BASE32_LOOKUP = new Map<string, number>(
  BASE32_ALPHABET.split('').map((char, index) => [char, index])
)

const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6

export function generateMfaSecret(size = 20): string {
  return encodeBase32(randomBytes(size))
}

export function normalizeOtpCode(value: any): string {
  return String(value || '').replace(/\D/g, '').slice(0, 10)
}

export function verifyTotpCode(secret: string, otp: string, window = 1): boolean {
  const normalizedCode = normalizeOtpCode(otp)
  if (!/^\d{6}$/.test(normalizedCode)) return false
  const key = decodeBase32(secret)
  if (key.length === 0) return false
  const nowCounter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS)
  for (let offset = -window; offset <= window; offset++) {
    const counter = nowCounter + offset
    if (counter < 0) continue
    if (generateHotp(key, counter) === normalizedCode) return true
  }
  return false
}

export function buildOtpAuthUri(input: {
  issuer: string
  username: string
  tenantId: string
  secret: string
}): string {
  const issuer = String(input.issuer || 'LatticePolicy').trim() || 'LatticePolicy'
  const username = String(input.username || '').trim() || 'user'
  const tenantId = String(input.tenantId || '').trim()
  const account = tenantId ? `${username}@${tenantId}` : username
  const label = encodeURIComponent(`${issuer}:${account}`)
  const query = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS)
  })
  return `otpauth://totp/${label}?${query.toString()}`
}

function generateHotp(key: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0)
  const digest = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  const otp = binary % 10 ** TOTP_DIGITS
  return String(otp).padStart(TOTP_DIGITS, '0')
}

function encodeBase32(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function decodeBase32(input: string): Buffer {
  const normalized = String(input || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of normalized) {
    const charValue = BASE32_LOOKUP.get(char)
    if (charValue == null) continue
    value = (value << 5) | charValue
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}
