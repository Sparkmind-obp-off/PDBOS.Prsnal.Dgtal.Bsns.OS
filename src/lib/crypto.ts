/**
 * Password hashing and token hashing using the Web Crypto API only
 * (no Node.js crypto — not available in the Workers runtime).
 *
 * Password format: pbkdf2$<iterations>$<salt_b64>$<hash_b64>
 */

const ITERATIONS = 100_000
const KEY_LEN = 32

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(str: string): Uint8Array {
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_LEN * 8
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const bits = await pbkdf2(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split('$')
    if (scheme !== 'pbkdf2') return false
    const bits = await pbkdf2(password, fromB64(saltB64), Number(iterStr))
    const a = new Uint8Array(bits)
    const b = fromB64(hashB64)
    if (a.length !== b.length) return false
    // constant-time comparison
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0
  } catch {
    return false
  }
}

/** Session tokens are stored only as a SHA-256 digest. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
