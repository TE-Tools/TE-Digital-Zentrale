// Erzeugt ein VAPID-Schlüsselpaar für Web Push (optional – ohne Secrets erzeugt der Worker selbst eins).
// Aufruf: node scripts/vapid.mjs   → Werte als Secrets hinterlegen:
//   npx wrangler secret put VAPID_PUBLIC_KEY --env produktion
//   npx wrangler secret put VAPID_PRIVATE_KEY --env produktion
const b64u = (b) => Buffer.from(b).toString('base64url');
const paar = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', paar.privateKey);
const roh = new Uint8Array(await crypto.subtle.exportKey('raw', paar.publicKey));
console.log('VAPID_PUBLIC_KEY=' + b64u(roh));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
