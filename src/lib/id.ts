/**
 * Sortable, URL-safe identifiers.
 * Time prefix (base36 ms) + random suffix — sortable by creation time,
 * generated with Web Crypto (available in Workers runtime).
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function randomPart(len = 12): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

export function newId(prefix?: string): string {
  const time = Date.now().toString(36).padStart(9, '0')
  const id = `${time}${randomPart(12)}`
  return prefix ? `${prefix}_${id}` : id
}

export function newToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}
