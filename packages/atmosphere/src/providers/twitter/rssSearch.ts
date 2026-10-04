import { fetchByRestId } from './conversation.js';
import { parseHandleOrId } from './profile.js';
import { buildAPITwitterStatus } from './processor.js';
import { isGraphQLTwitterStatus } from '../../helpers/graphql-twitter.js';
import { isTombstone } from '../../helpers/tombstone.js';
import { searchQueryTooLongError, TWITTER_SEARCH_RAW_QUERY_MAX_LENGTH } from './searchErrors.js';
import { getTwitterProviderEnv } from '../twitter-runtime.js';
import type { APISearchResults, APITwitterStatus, ApiQueryError } from '../../types/api-schemas.js';
import type { FetchResults } from '../../types/fetch-results.js';
import type { TwitterBuildHost } from './build-host.js';

type SearchFeed = 'latest' | 'top' | 'media';

type RelayRssItem = {
  id: string;
  handle: string;
  text: string;
  createdAt: string;
};

type RelayCursorState = {
  v: 1;
  until: string;
  seen: string[];
};

const RELAY_RESULTS_PER_WINDOW = 20;
const RELAY_HYDRATE_CONCURRENCY = 5;
const RELAY_FETCH_TIMEOUT_MS = 15000;

const emptyCursor = { top: null, bottom: null };

const emptyResults = (code: 404): APISearchResults => ({
  code,
  results: [],
  cursor: { ...emptyCursor }
});

/** Workers-core base64url codec (no Buffer: the worker has no nodejs_compat flag). */
const b64urlEncode = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach(b => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64urlDecode = (s: string): string => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/** Decode our opaque window cursor. Anything else (legacy X cursors, junk) starts fresh. */
export const decodeRelayCursor = (cursor: string | null): RelayCursorState | null => {
  if (!cursor) {
    return null;
  }
  try {
    const json = b64urlDecode(cursor);
    const parsed = JSON.parse(json) as Partial<RelayCursorState>;
    if (parsed?.v !== 1 || typeof parsed.until !== 'string' || !Array.isArray(parsed.seen)) {
      return null;
    }
    if (Number.isNaN(Date.parse(parsed.until))) {
      return null;
    }
    return { v: 1, until: parsed.until, seen: parsed.seen.filter(s => typeof s === 'string') };
  } catch {
    return null;
  }
};

export const encodeRelayCursor = (until: string, seen: string[]): string =>
  b64urlEncode(JSON.stringify({ v: 1, until, seen }));

/** Map our feed + lang + window onto the relay query string (all X operators pass through). */
export const buildRelayQuery = (
  q: string,
  feed: SearchFeed,
  language: string | undefined,
  untilIso: string | null
): string => {
  let query = q.trim();
  if (feed === 'media' && !/filter:\S/i.test(query)) {
    query += ' filter:media';
  }
  if (language && !/(^|\s)lang:/i.test(query)) {
    query += ` lang:${language}`;
  }
  if (untilIso) {
    // Page backwards: only posts older than the previous window. Date (not time)
    // keeps windows stable and overlapping; seen-ids dedupe the seam.
    const day = untilIso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && !/(^|\s)until:/i.test(query)) {
      query += ` until:${day}`;
    }
  }
  return query;
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return '';
      }
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const stripTags = (html: string): string =>
  decodeEntities(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Minimal regex RSS parse (no DOMParser dependency); skips ghost items without ids. */
export const parseRelayRss = (xml: string): RelayRssItem[] => {
  const items: RelayRssItem[] = [];
  const seen = new Set<string>();
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  for (const block of blocks) {
    const pick = (tag: string): string | null => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : null;
    };
    const link = pick('link');
    const idMatch = link ? /\/status\/(\d+)/.exec(link) : null;
    if (!idMatch) {
      continue;
    }
    const id = idMatch[1];
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const handleMatch = link ? /\/([A-Za-z0-9_]+)\/status\//.exec(link) : null;
    const creator = pick('dc:creator') ?? pick('creator');
    const handle =
      (handleMatch ? handleMatch[1] : creator ? creator.replace(/^@/, '') : 'unknown').trim() ||
      'unknown';
    const description = pick('description') ?? pick('title') ?? '';
    const pubDate = pick('pubDate') ?? '';
    const parsed = Date.parse(pubDate);
    items.push({
      id,
      handle,
      text: stripTags(description),
      createdAt: Number.isNaN(parsed) ? new Date(0).toISOString() : new Date(parsed).toISOString()
    });
  }
  return items;
};

const fetchRelayXml = async (url: string, userAgent: string): Promise<string | null> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RELAY_FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { 'User-Agent': userAgent, 'Accept': 'application/rss+xml, application/xml' },
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        continue;
      }
      const text = await response.text();
      // Volunteer RSS flakes (~1 in 10): truncated bodies, error pages.
      if (!text.includes('<item>')) {
        continue;
      }
      return text;
    } catch {
      // Timeout / abort / network: one retry, then give up.
    }
  }
  return null;
};

const relaySearchUrl = (root: string, query: string): string =>
  `${root.replace(/\/$/, '')}/search/rss?f=tweets&q=${encodeURIComponent(query)}`;

const relayProfileUrl = (
  root: string,
  handle: string,
  tab: 'statuses' | 'media' | 'replies'
): string => {
  const base = `${root.replace(/\/$/, '')}/${encodeURIComponent(handle)}`;
  if (tab === 'media') {
    return `${base}/media/rss`;
  }
  if (tab === 'replies') {
    return `${base}/with_replies/rss`;
  }
  return `${base}/rss`;
};

const relayProfileSearchUrl = (root: string, handle: string, query: string): string =>
  `${root.replace(/\/$/, '')}/${encodeURIComponent(handle)}/search/rss?f=tweets&q=${encodeURIComponent(query)}`;

const hydrateOne = async (
  id: string,
  host: TwitterBuildHost,
  language: string | undefined
): Promise<APITwitterStatus | null> => {
  try {
    const response = await fetchByRestId(id, host, undefined, language);
    const tweet = (response as { data?: { tweetResult?: { result?: unknown } } })?.data?.tweetResult
      ?.result;
    if (!isGraphQLTwitterStatus(tweet)) {
      return null;
    }
    const built = await buildAPITwitterStatus(
      host,
      tweet as GraphQLTwitterStatus,
      language,
      null,
      false,
      false
    );
    if (!built || isTombstone(built) || (built as FetchResults)?.status) {
      return null;
    }
    return built as APITwitterStatus;
  } catch {
    return null;
  }
};

/**
 * X keyword search via the search-relay RSS discovery + per-post hydration through our
 * own TweetDetail path (full envelopes: stats, media, facets). Pagination walks
 * since:/until: time windows encoded in our opaque cursor (no X cursors involved).
 */
export const rssSearchAPI = async (
  query: string,
  feed: SearchFeed,
  count: number,
  cursor: string | null,
  host: TwitterBuildHost,
  language?: string
): Promise<APISearchResults | ApiQueryError> => {
  if (query.length > TWITTER_SEARCH_RAW_QUERY_MAX_LENGTH) {
    return searchQueryTooLongError(query.length);
  }
  if (!query.trim()) {
    return { code: 400, message: 'Query must not be empty' };
  }

  const env = getTwitterProviderEnv();
  const cursorState = decodeRelayCursor(cursor);
  const seen = new Set(cursorState?.seen ?? []);
  const relayQuery = buildRelayQuery(query, feed, language, cursorState?.until ?? null);

  const xml = await fetchRelayXml(
    relaySearchUrl(env.searchRelayRoot, relayQuery),
    `${env.friendlyUserAgent}/rss-search-relay`
  );
  if (!xml) {
    return emptyResults(404);
  }

  const window = await hydrateRssWindow(xml, count, host, language, seen);
  if (!window) {
    return emptyResults(404);
  }
  return windowEnvelope(window);
};

/**
 * Profile timeline via relay: page 1 reads the profile RSS tab, later pages walk
 * `from:` time windows on global search RSS (profile RSS has no cursors).
 * Screen names only (`id:123` keeps the primary result) - same APISearchResults envelope.
 */
export const rssProfileTimelineAPI = async (
  handleOrId: string,
  tab: 'statuses' | 'media' | 'replies',
  count: number,
  cursor: string | null,
  host: TwitterBuildHost,
  language?: string
): Promise<APISearchResults | ApiQueryError> => {
  const parsed = parseHandleOrId(handleOrId);
  if (parsed.type !== 'screenName' || !parsed.value) {
    return emptyResults(404);
  }
  const handle = parsed.value.replace(/^@/, '');
  if (!handle) {
    return emptyResults(404);
  }

  const env = getTwitterProviderEnv();
  const userAgent = `${env.friendlyUserAgent}/rss-search-relay`;
  const cursorState = decodeRelayCursor(cursor);
  const seen = new Set(cursorState?.seen ?? []);
  let url: string;
  if (cursorState?.until) {
    let windowQuery = `from:${handle} until:${cursorState.until.slice(0, 10)}`;
    if (tab === 'media') {
      windowQuery += ' filter:media';
    }
    url = relaySearchUrl(env.searchRelayRoot, windowQuery);
  } else {
    url = relayProfileUrl(env.searchRelayRoot, handle, tab);
  }

  const xml = await fetchRelayXml(url, userAgent);
  if (!xml) {
    return emptyResults(404);
  }
  const window = await hydrateRssWindow(xml, count, host, language, seen);
  if (!window) {
    return emptyResults(404);
  }
  return windowEnvelope(window);
};

/**
 * Per-user keyword search via relay (`/{handle}/search/rss`), paged through
 * since:/until: windows like global search. Same APISearchResults envelope.
 */
export const rssProfileSearchAPI = async (
  handleOrId: string,
  query: string,
  feed: SearchFeed,
  count: number,
  cursor: string | null,
  host: TwitterBuildHost,
  language?: string
): Promise<APISearchResults | ApiQueryError> => {
  if (query.length > TWITTER_SEARCH_RAW_QUERY_MAX_LENGTH) {
    return searchQueryTooLongError(query.length);
  }
  if (!query.trim()) {
    return { code: 400, message: 'Query must not be empty' };
  }
  const parsed = parseHandleOrId(handleOrId);
  if (parsed.type !== 'screenName' || !parsed.value) {
    return emptyResults(404);
  }
  const handle = parsed.value.replace(/^@/, '');
  if (!handle) {
    return emptyResults(404);
  }

  const env = getTwitterProviderEnv();
  const cursorState = decodeRelayCursor(cursor);
  const seen = new Set(cursorState?.seen ?? []);
  const relayQuery = buildRelayQuery(query, feed, language, cursorState?.until ?? null);
  const xml = await fetchRelayXml(
    relayProfileSearchUrl(env.searchRelayRoot, handle, relayQuery),
    `${env.friendlyUserAgent}/rss-search-relay`
  );
  if (!xml) {
    return emptyResults(404);
  }
  const window = await hydrateRssWindow(xml, count, host, language, seen);
  if (!window) {
    return emptyResults(404);
  }
  return windowEnvelope(window);
};

type HydratedWindow = {
  results: APITwitterStatus[];
  seen: string[];
  oldest: string;
};

/** Parse, dedupe, hydrate one relay window. Shared by search, profile and profile-search. */
const hydrateRssWindow = async (
  xml: string,
  count: number,
  host: TwitterBuildHost,
  language: string | undefined,
  seen: Set<string>
): Promise<HydratedWindow | null> => {
  const fresh = parseRelayRss(xml).filter(item => !seen.has(item.id));
  if (fresh.length === 0) {
    return null;
  }

  const candidates = fresh.slice(0, Math.max(1, Math.min(count, RELAY_RESULTS_PER_WINDOW)));
  const built: APITwitterStatus[] = [];
  // Bounded hydration: same per-post cost as one status lookup each, gentle on upstream.
  for (let i = 0; i < candidates.length; i += RELAY_HYDRATE_CONCURRENCY) {
    const batch = candidates.slice(i, i + RELAY_HYDRATE_CONCURRENCY);
    const hydrated = await Promise.all(batch.map(item => hydrateOne(item.id, host, language)));
    for (let j = 0; j < batch.length; j++) {
      const status = hydrated[j];
      if (status) {
        built.push(status);
        seen.add(batch[j].id);
      }
    }
  }
  if (built.length === 0) {
    return null;
  }

  const oldest = fresh
    .map(item => item.createdAt)
    .sort()
    .at(0) as string;
  return { results: built, seen: [...seen], oldest };
};

const windowEnvelope = (window: HydratedWindow): APISearchResults => {
  const nextUntil = new Date(new Date(window.oldest).getTime() - 1000).toISOString();
  return {
    code: 200,
    results: window.results,
    cursor: {
      top: null,
      bottom: encodeRelayCursor(nextUntil, window.seen)
    }
  };
};
