import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  setBlueskyProviderEnv,
  setBlueskyProxyRuntime
} from '@fxembed/atmosphere/providers/bluesky-runtime';

const credMocks = vi.hoisted(() => ({
  initCredentials: vi.fn().mockResolvedValue(undefined),
  hasBundledEncryptedCredentials: vi.fn(() => true),
  hasBlueskyProxyAccounts: vi.fn(() => true),
  getShuffledBlueskyAccounts: vi.fn(() => [
    { identifier: 'u.test', appPassword: 'x', service: 'https://pds.example' }
  ])
}));

const sessionMocks = vi.hoisted(() => ({
  getBlueskyAccessJwt: vi.fn().mockResolvedValue('jwt-test'),
  invalidateBlueskySession: vi.fn()
}));

vi.mock('@fxembed/atmosphere/providers/bluesky/session', () => sessionMocks);

import {
  fetchActorProfile,
  fetchPostThread,
  fetchPostThreadResult,
  fetchSearchPosts
} from '@fxembed/atmosphere/providers/bluesky/client';

beforeEach(() => {
  setBlueskyProviderEnv({
    apiRoot: 'https://public.api.bsky.app',
    webRoot: 'https://bsky.app',
    videoBase: 'https://video.bsky.app',
    mosaicBskyDomainList: [],
    polyglotDomainList: []
  });
  setBlueskyProxyRuntime({
    initCredentials: credMocks.initCredentials,
    hasBundledEncryptedCredentials: credMocks.hasBundledEncryptedCredentials,
    hasBlueskyProxyAccounts: credMocks.hasBlueskyProxyAccounts,
    getShuffledBlueskyAccounts: credMocks.getShuffledBlueskyAccounts,
    blueskyProxyServiceHostname: (service: string) => {
      try {
        const s = service.trim();
        const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
        return new URL(withProto).hostname.toLowerCase();
      } catch {
        return '';
      }
    }
  });
  credMocks.initCredentials.mockClear();
  sessionMocks.getBlueskyAccessJwt.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('fetchPostThread uses PDS proxy when public API returns 503', async () => {
  const calls: { url: string; authorization?: string }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      const headers = init?.headers;
      let authorization: string | undefined;
      if (
        headers &&
        typeof headers === 'object' &&
        !Array.isArray(headers) &&
        !(headers instanceof Headers)
      ) {
        authorization = (headers as Record<string, string>)['Authorization'];
      } else if (headers instanceof Headers) {
        authorization = headers.get('Authorization') ?? undefined;
      }
      calls.push({ url, authorization });

      if (url.includes('public.api.bsky.app')) {
        return new Response('unavailable', { status: 503 });
      }
      if (url.includes('pds.example')) {
        expect(authorization).toBe('Bearer jwt-test');
        return new Response(JSON.stringify({ thread: { $type: 'test', post: null } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }
  );

  const result = await fetchPostThread('at://did:plc:x/app.bsky.feed.post/rkey', 1, undefined, {
    credentialKey: 'dummy-key'
  });

  expect(result).not.toBeNull();
  expect(calls.some(c => c.url.includes('public.api.bsky.app'))).toBe(true);
  expect(calls.some(c => c.url.includes('pds.example'))).toBe(true);
  expect(credMocks.initCredentials).toHaveBeenCalledWith('dummy-key');
});

test('fetchPostThreadResult marks explicit NotFound separately from upstream failure', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('public.api.bsky.app')) {
      return new Response(JSON.stringify({ error: 'NotFound', message: 'Not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const notFoundResult = await fetchPostThreadResult(
    'at://did:plc:x/app.bsky.feed.post/missing',
    1,
    undefined,
    { credentialKey: 'dummy-key' }
  );
  expect(notFoundResult.ok).toBe(false);
  if (!notFoundResult.ok) {
    expect(notFoundResult.notFound).toBe(true);
  }

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('public.api.bsky.app')) {
      return new Response('unavailable', { status: 503 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const outageResult = await fetchPostThreadResult(
    'at://did:plc:x/app.bsky.feed.post/rkey',
    1,
    undefined,
    { credentialKey: undefined }
  );
  expect(outageResult.ok).toBe(false);
  if (!outageResult.ok) {
    expect(outageResult.notFound).toBe(false);
  }
});

test('fetchPostThread does not call proxy when public returns NotFound', async () => {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    if (url.includes('public.api.bsky.app')) {
      return new Response(JSON.stringify({ error: 'NotFound', message: 'Not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const result = await fetchPostThread('at://did:plc:x/app.bsky.feed.post/missing', 1, undefined, {
    credentialKey: 'dummy-key'
  });

  expect(result).toBeNull();
  expect(calls.length).toBe(1);
  expect(calls[0]).toContain('public.api.bsky.app');
  expect(credMocks.initCredentials).not.toHaveBeenCalled();
});

test('fetchPostThreadResult includes proxyHostHint when proxy fallback succeeds', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('public.api.bsky.app')) {
      return new Response('unavailable', { status: 503 });
    }
    if (url.includes('pds.example')) {
      return new Response(JSON.stringify({ thread: { $type: 'test', post: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const result = await fetchPostThreadResult(
    'at://did:plc:x/app.bsky.feed.post/rkey',
    1,
    undefined,
    { credentialKey: 'dummy-key' }
  );

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data).not.toBeNull();
    expect(result.proxyHostHint).toBe('pds.example');
  }
});

test('fetchPostThread passes preferredProxyServiceHost into proxy shuffle', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('public.api.bsky.app')) {
      return new Response('unavailable', { status: 503 });
    }
    if (url.includes('pds.example')) {
      return new Response(JSON.stringify({ thread: { $type: 'test', post: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  credMocks.getShuffledBlueskyAccounts.mockClear();

  await fetchPostThread('at://did:plc:x/app.bsky.feed.post/rkey', 1, undefined, {
    credentialKey: 'dummy-key',
    preferredProxyServiceHost: 'pds.example'
  });

  expect(credMocks.getShuffledBlueskyAccounts).toHaveBeenCalledWith('pds.example');
});

test('fetchPostThread does not use proxy shuffle when public API succeeds', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(JSON.stringify({ thread: { $type: 'test', post: null } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  credMocks.getShuffledBlueskyAccounts.mockClear();

  await fetchPostThread('at://did:plc:x/app.bsky.feed.post/rkey', 1, undefined, {
    credentialKey: 'dummy-key',
    preferredProxyServiceHost: 'pds.example'
  });

  expect(credMocks.getShuffledBlueskyAccounts).not.toHaveBeenCalled();
});

test('fetchActorProfile preserves public outage when proxy returns NotFound', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('public.api.bsky.app')) {
      return new Response('upstream overloaded', { status: 503 });
    }
    if (url.includes('pds.example')) {
      return new Response(JSON.stringify({ error: 'NotFound', message: 'Record not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const result = await fetchActorProfile('did:plc:test', { credentialKey: 'dummy-key' });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(503);
    expect(result.body).toContain('overloaded');
  }
});

test('fetchSearchPosts retries on the alternate AppView when the primary 403s', async () => {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    if (url.includes('public.api.bsky.app')) {
      return new Response('<html>403 block page</html>', { status: 403 });
    }
    if (url.includes('https://api.bsky.app')) {
      return new Response(
        JSON.stringify({ posts: [{ uri: 'at://did:plc:x/app.bsky.feed.post/r' }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const first = await fetchSearchPosts({ q: 'openai', sort: 'latest', limit: 5 });

  expect(first.ok).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toContain('public.api.bsky.app');
  expect(calls[1]).toContain('https://api.bsky.app');

  const second = await fetchSearchPosts({ q: 'more', sort: 'top', limit: 5 });

  expect(second.ok).toBe(true);
  expect(calls.filter(u => u.includes('public.api.bsky.app'))).toHaveLength(1);
  expect(calls.filter(u => u.includes('https://api.bsky.app'))).toHaveLength(2);
});

test('fetchSearchPosts surfaces a definitive alternate error over the edge 403 block', async () => {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    if (url.includes('public.api.bsky.app')) {
      return new Response('<html>403 block page</html>', { status: 403 });
    }
    if (url.includes('https://api.bsky.app')) {
      return new Response(JSON.stringify({ error: 'BadRequest', message: 'bad query' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const result = await fetchActorProfile('did:plc:test');

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.body).toContain('bad query');
  }
  expect(calls[0]).toContain('public.api.bsky.app');
  expect(calls[1]).toContain('https://api.bsky.app');
});
