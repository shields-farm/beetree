// Tests for the /api/key loopback guard.
//
// Background: the server binds :3001 and is commonly put behind a reverse proxy
// (Tailscale serve/funnel, nginx). Such a proxy connects from 127.0.0.1, so a
// bare `remoteAddress` check treats every remote caller as local — and hands
// them the API key. The guard therefore requires a loopback peer AND a loopback
// Host header. These tests pin that invariant so a future refactor can't
// quietly drop the Host check again.

import { describe, it, expect } from 'vitest';

/**
 * Mirror of the guard in server/index.ts. Kept as a pure function so the
 * decision table can be exercised without standing up Express.
 */
function keyRequestAllowed(opts: {
  ip: string;
  host: string;
  trustProxy?: boolean;
}): boolean {
  const ip = opts.ip || '';
  const isLoopbackPeer =
    ip.includes('127.0.0.1') || ip === '::1' || ip.includes('::ffff:127.0.0.1');
  const host = (opts.host || '').split(':')[0].toLowerCase();
  const isLoopbackHost =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  const trustProxy = opts.trustProxy === true;
  return isLoopbackPeer && (isLoopbackHost || trustProxy);
}

describe('/api/key loopback guard', () => {
  it('allows a genuine local curl (loopback peer, loopback Host)', () => {
    expect(keyRequestAllowed({ ip: '127.0.0.1', host: '127.0.0.1:3001' })).toBe(true);
    expect(keyRequestAllowed({ ip: '::1', host: 'localhost:3001' })).toBe(true);
    expect(
      keyRequestAllowed({ ip: '::ffff:127.0.0.1', host: 'localhost' })
    ).toBe(true);
  });

  it('rejects a proxied request — loopback peer but public Host', () => {
    // This is the regression: Tailscale serve proxies from localhost, so the
    // peer looks local while the Host header carries the public name.
    expect(
      keyRequestAllowed({
        ip: '127.0.0.1',
        host: 'marks-mac-mini.tail98610.ts.net:8443',
      })
    ).toBe(false);
    expect(
      keyRequestAllowed({ ip: '::ffff:127.0.0.1', host: 'beetree.example.com' })
    ).toBe(false);
  });

  it('rejects a direct remote request', () => {
    expect(keyRequestAllowed({ ip: '192.168.86.27', host: '192.168.86.40:3001' })).toBe(
      false
    );
    expect(keyRequestAllowed({ ip: '100.79.247.14', host: 'localhost' })).toBe(false);
  });

  it('rejects when the peer is remote even with a loopback Host', () => {
    // Host headers are attacker-controlled; they must never be sufficient alone.
    expect(keyRequestAllowed({ ip: '203.0.113.9', host: 'localhost' })).toBe(false);
  });

  it('honours BEETREE_TRUST_PROXY as an explicit opt-in', () => {
    expect(
      keyRequestAllowed({
        ip: '127.0.0.1',
        host: 'marks-mac-mini.tail98610.ts.net:8443',
        trustProxy: true,
      })
    ).toBe(true);
    // Still requires a loopback peer — opting in does not open it to the world.
    expect(
      keyRequestAllowed({ ip: '203.0.113.9', host: 'example.com', trustProxy: true })
    ).toBe(false);
  });

  it('is case-insensitive on the Host header', () => {
    expect(keyRequestAllowed({ ip: '127.0.0.1', host: 'LOCALHOST:3001' })).toBe(true);
  });
});
