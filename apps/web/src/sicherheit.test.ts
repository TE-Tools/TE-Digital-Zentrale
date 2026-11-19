import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const headers = readFileSync(fileURLToPath(new URL('../public/_headers', import.meta.url)), 'utf8');

describe('Sicherheits-Header der PWA (public/_headers)', () => {
  const csp = headers.match(/Content-Security-Policy: (.*)/)?.[1] ?? '';

  it('strenge Content-Security-Policy ohne fremde Quellen', () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/https?:\/\//); // keine externen Domains (Schriften sind selbst gehostet)
  });

  it('weitere Schutz-Header', () => {
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
    expect(headers).toMatch(/X-Frame-Options: DENY/);
    expect(headers).toMatch(/Strict-Transport-Security: max-age=\d{7,}/);
    expect(headers).toMatch(/Referrer-Policy: strict-origin-when-cross-origin/);
    expect(headers).toMatch(/Permissions-Policy: .*camera=\(\)/);
  });
});
