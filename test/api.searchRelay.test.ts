import { afterEach, expect, test, vi } from 'vitest';
import { app } from '../src/worker';
import harness from './helpers/harness';
import {
  buildRelayQuery,
  decodeRelayCursor,
  parseRelayRss
} from '@fxembed/atmosphere/providers/twitter/rssSearch';
import searchRss from './fixtures/nitter/search-blogging.xml?raw';
import profileRss from './fixtures/nitter/profile-elonmusk.xml?raw';
import profileSearchRss from './fixtures/nitter/profile-search-xai.xml?raw';

const stubRelayFetch = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const u = typeof input === 'string' ? input : input.url;
    if (u.includes('/elonmusk/search/rss')) {
      return new Response(profileSearchRss, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' }
      });
    }
    if (u.includes('/search/rss')) {
      return new Response(searchRss, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' }
      });
    }
    if (u.includes('nitter.kareem.one')) {
      return new Response(profileRss, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' }
      });
    }
    throw new Error(`Unexpected fetch: ${u}`);
  });

afterEach(() => {
  vi.restoreAllMocks();
});

test('relay query builder maps feed/lang/window options', () => {
  expect(buildRelayQuery('openai', 'latest', undefined, null)).toEqual('openai');
  expect(buildRelayQuery('openai', 'media', undefined, null)).toEqual('openai filter:media');
  expect(buildRelayQuery('openai filter:videos', 'media', undefined, null)).toEqual(
    'openai filter:videos'
  );
  expect(buildRelayQuery('openai', 'latest', 'es', null)).toEqual('openai lang:es');
  expect(buildRelayQuery('openai', 'latest', undefined, '2026-09-25T15:59:52.000Z')).toEqual(
    'openai until:2026-09-25'
  );
});

test('relay cursor codec round-trips, rejects junk', () => {
  expect(decodeRelayCursor(null)).toBeNull();
  expect(decodeRelayCursor('not-a-cursor')).toBeNull();
});

test('relay RSS parser skips ghosts and dedupes', () => {
  const items = parseRelayRss(searchRss);
  // 2 hydratable + 1 unknown id; the empty ghost item is skipped.
  expect(items.map(item => item.id)).toEqual(['20', '1841206275088290279', '9999999999999999999']);
  expect(items[0].handle).toEqual('jack');
  expect(items[0].text).toEqual('just setting up my twttr');
});

test('GET /2/search hydrates relay ids to full statuses', async () => {
  stubRelayFetch();
  const res = await app.request(
    'https://api.fxtwitter.com/2/search?q=blogging',
    {
      headers: { 'User-Agent': 'FxEmbedTest/1.0' }
    },
    harness
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as {
    code: number;
    results: { id: string }[];
    cursor: { top: string | null; bottom: string | null };
  };
  expect(body.code).toEqual(200);
  // Unknown id 9999999999999999999 fails hydration and is dropped.
  expect(body.results.map(status => status.id).sort()).toEqual(['1841206275088290279', '20']);
  expect(typeof body.cursor.bottom).toEqual('string');
  // Opaque window cursor must decode to a state carrying the seen ids.
  const state = decodeRelayCursor(body.cursor.bottom as string);
  expect(state?.seen).toContain('20');
  expect(state?.seen).toContain('1841206275088290279');
});

test('GET /2/search page 2 exhausts the seen window', async () => {
  stubRelayFetch();
  const first = await app.request(
    'https://api.fxtwitter.com/2/search?q=blogging',
    {
      headers: { 'User-Agent': 'FxEmbedTest/1.0' }
    },
    harness
  );
  const firstBody = (await first.json()) as { cursor: { bottom: string } };
  const second = await app.request(
    `https://api.fxtwitter.com/2/search?q=blogging&cursor=${encodeURIComponent(firstBody.cursor.bottom)}`,
    { headers: { 'User-Agent': 'FxEmbedTest/1.0' } },
    harness
  );
  // Same fixture on page 2: every id already seen -> honest empty envelope.
  expect(second.status).toEqual(404);
});

test('GET /2/search rejects empty queries', async () => {
  stubRelayFetch();
  const res = await app.request(
    'https://api.fxtwitter.com/2/search?q=',
    {
      headers: { 'User-Agent': 'FxEmbedTest/1.0' }
    },
    harness
  );
  expect(res.status).toEqual(400);
});

test('GET /ai/2/search renders relay results as markdown', async () => {
  stubRelayFetch();
  // NOTE: /ai lives on the worker host itself (api.* hosts rewrite /ai/* into /api/*).
  // NOTE 2: selfJson re-enters app.request, which needs an ExecutionContext shim in tests.
  const executionCtx = { waitUntil() {}, passThroughOnException() {} } as never;
  const res = await app.request(
    'https://fixtweet.twapiworker.workers.dev/ai/2/search?q=blogging',
    { headers: { 'User-Agent': 'FxEmbedTest/1.0' } },
    harness,
    executionCtx
  );
  if (res.status !== 200) {
    throw new Error('ai search failed: ' + (await res.text()).slice(0, 200));
  }
  const text = await res.text();
  expect(text).toContain('Search');
});

test('profile statuses fall back to relay when the primary 404s', async () => {
  stubRelayFetch();
  const res = await app.request(
    'https://api.fxtwitter.com/2/profile/relayuser/statuses',
    {
      headers: { 'User-Agent': 'FxEmbedTest/1.0' }
    },
    harness
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as { code: number; results: { id: string }[] };
  expect(body.code).toEqual(200);
  expect(body.results.map(status => status.id).sort()).toEqual(['1841206275088290279', '20']);
});

test('profile media falls back to the relay media tab', async () => {
  stubRelayFetch();
  const res = await app.request(
    'https://api.fxtwitter.com/2/profile/relayuser/media',
    {
      headers: { 'User-Agent': 'FxEmbedTest/1.0' }
    },
    harness
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as { code: number; results: unknown[] };
  expect(body.code).toEqual(200);
  expect(body.results.length).toBeGreaterThan(0);
});

test('quotes fall back to relay quoted_tweet_id search', async () => {
  stubRelayFetch();
  const res = await app.request(
    'https://api.fxtwitter.com/2/status/9999999999999999999/quotes',
    {
      headers: { 'User-Agent': 'FxEmbedTest/1.0' }
    },
    harness
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as { code: number; results: { id: string }[] };
  expect(body.code).toEqual(200);
  expect(body.results.length).toBeGreaterThan(0);
});

test('GET /2/profile/{handle}/search serves per-user relay search', async () => {
  stubRelayFetch();
  const res = await app.request(
    'https://api.fxtwitter.com/2/profile/elonmusk/search?q=xai',
    {
      headers: { 'User-Agent': 'FxEmbedTest/1.0' }
    },
    harness
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as { code: number; results: { id: string }[] };
  expect(body.code).toEqual(200);
  expect(body.results.map(status => status.id)).toEqual(['20']);
});

test('GET /ai/2/profile/{handle}/search renders markdown', async () => {
  stubRelayFetch();
  const executionCtx = { waitUntil() {}, passThroughOnException() {} } as never;
  const res = await app.request(
    'https://fixtweet.twapiworker.workers.dev/ai/2/profile/elonmusk/search?q=xai',
    { headers: { 'User-Agent': 'FxEmbedTest/1.0' } },
    harness,
    executionCtx
  );
  expect(res.status).toEqual(200);
  expect(await res.text()).toContain('Posts by');
});
