/** Kleine, abhängigkeitsfreie Krypto-Helfer (WebCrypto). */

export function zufallsBytes(laenge: number): Uint8Array {
  const bytes = new Uint8Array(laenge);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function vonBase64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function zufallsId(laenge = 16): string {
  return base64url(zufallsBytes(laenge));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Vergleich in konstanter Zeit (über Hashes, damit die Länge nichts verrät). */
export async function sicherGleich(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

/** Wiederherstellungscode im Format XXXX-XXXX-XXXX (ohne verwechselbare Zeichen). */
export function wiederherstellungscode(): string {
  const zeichen = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = zufallsBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += zeichen[bytes[i]! % zeichen.length];
    if (i === 3 || i === 7) code += '-';
  }
  return code;
}

export function normalisiereCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
}
