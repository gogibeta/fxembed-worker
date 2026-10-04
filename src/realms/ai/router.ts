import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { app } from '../../worker';
import { Constants } from '../../constants';
import {
  isOk,
  mdConversationDoc,
  mdError,
  mdList,
  mdProfileDoc,
  mdSearchDoc,
  mdStatus,
  mdThreadDoc
} from './markdown';
import { resolveSocialUrl } from './resolve';
import { llmsTxt } from './llms';

export const ai = new Hono();

const AI_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'content-type': 'text/markdown; charset=utf-8',
  'x-powered-by': 'fxembed-ai',
  'Vary': 'Accept-Encoding, User-Agent'
};

const mdHeaders = (): Record<string, string> => ({
  ...Constants.API_RESPONSE_HEADERS,
  ...AI_HEADERS
});

/** Call this worker's own JSON endpoint in-process (no subrequest: same-zone
   fetch() is rejected by the edge with error 1042). Query string passes through. */
const selfJson = async (
  c: Ctx,
  internalPath: string
): Promise<{ http: number; payload: Record<string, unknown> }> => {
  const ua = c.req.header('user-agent') ?? 'FxEmbedAI/1.0';
  const url = new URL(c.req.url);
  const target = `${url.origin}${internalPath}${url.search}`;
  try {
    const r = await app.request(target, { headers: { 'user-agent': ua } }, c.env, c.executionCtx);
    const text = await r.text();
    try {
      return { http: r.status, payload: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { http: r.status, payload: { code: r.status, message: text.slice(0, 300) } };
    }
  } catch (err) {
    return {
      http: 502,
      payload: {
        code: 502,
        message: `AI bridge failed for ${internalPath}: ${String(err).slice(0, 200)}`
      }
    };
  }
};

const sendMd = (c: Ctx, http: number, md: string) => {
  /* c.body (not c.text) so our text/markdown content-type survives. */
  return c.body(md, http, mdHeaders());
};

/* Same contract as the JSON API realms: identify yourself. */
ai.use('*', async (c, next) => {
  if (!c.req.header('user-agent')) {
    return sendMd(
      c as unknown as Ctx,
      401,
      '# Error\n\n> Use the /ai endpoints with a User-Agent header, e.g. `MyAgent/1.0`.'
    );
  }
  await next();
});

ai.use(trimTrailingSlash());

type Ctx = {
  req: {
    url: string;
    param: (k?: string) => string | Record<string, string>;
    query: (k?: string) => string | Record<string, string>;
    header: (k: string) => string | undefined;
  };
  status: (s: number) => void;
  header: (k: string, v: string) => void;
  text: (t: string) => Response | Promise<Response>;
  body: (
    t: string,
    status?: number,
    headers?: Record<string, string>
  ) => Response | Promise<Response>;
  env?: Record<string, string>;
  executionCtx?: ExecutionContext;
};

const paramOf = (c: Ctx, k: string): string => {
  const p = c.req.param(k);
  return typeof p === 'string' ? p : '';
};

ai.get('/', c => {
  const cc = c as unknown as Ctx;
  return sendMd(
    cc,
    200,
    [
      '# FxEmbed AI endpoints',
      '',
      'Same data as the JSON API, rendered as token-lean Markdown for LLMs.',
      'Requires a `User-Agent` header. Full guide: `/llms.txt` (also `/llm.txt`).',
      '',
      '## X / Twitter',
      ...[
        '/ai/2/status/{id}',
        '/ai/2/thread/{id}',
        '/ai/2/conversation/{id}',
        '/ai/2/profile/{handle}',
        '/ai/2/profile/{handle}/statuses',
        '/ai/2/profile/{handle}/search?q=',
        '/ai/2/profile/{handle}/media',
        '/ai/2/status/{id}/quotes',
        '/ai/2/search?q=',
        '/ai/2/trends'
      ].map(p => `- \`${p}\``),
      '',
      '## Bluesky',
      ...[
        '/ai/2/bsky/profile/{handle}',
        '/ai/2/bsky/profile/{handle}/statuses',
        '/ai/2/bsky/status/{handle}/{rkey}',
        '/ai/2/bsky/thread/{handle}/{rkey}',
        '/ai/2/bsky/search?q='
      ].map(p => `- \`${p}\``),
      '',
      '## TikTok / Instagram / Threads / Mastodon',
      ...[
        '/ai/2/tiktok/status/{id}',
        '/ai/2/tiktok/profile/{handle}',
        '/ai/2/instagram/profile/{user}',
        '/ai/2/threads/profile/{user}',
        '/ai/2/mastodon/{domain}/profile/{handle}'
      ].map(p => `- \`${p}\``),
      '',
      '## Universal (any supported URL)',
      '- `/ai/2/post?url=` — paste an x.com, bsky.app, tiktok.com, instagram.com, threads.com or Mastodon URL, get Markdown back.',
      '',
      'Docs: `/ai/2/openapi.json`'
    ].join('\n')
  );
});

ai.get('/version', c =>
  sendMd(c, 200, `# AI realm\n\nMarkdown twin of the FxEmbed JSON API. See \`/llms.txt\`.`)
);

ai.get('/robots.txt', c => {
  c.status(200);
  c.header('content-type', 'text/plain; charset=utf-8');
  c.header('access-control-allow-origin', '*');
  return c.text('User-agent: *\nAllow: /\n');
});

ai.get('/llms.txt', c => {
  const cc = c as unknown as Ctx;
  cc.header('content-type', 'text/plain; charset=utf-8');
  return cc.body(llmsTxt(new URL(cc.req.url).origin), 200, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=3600'
  });
});

ai.get('/2/openapi.json', c => {
  const cc = c as unknown as Ctx;
  const paths = [
    '/ai/2/status/{id}',
    '/ai/2/thread/{id}',
    '/ai/2/conversation/{id}',
    '/ai/2/profile/{handle}',
    '/ai/2/profile/{handle}/statuses',
    '/ai/2/profile/{handle}/search',
    '/ai/2/profile/{handle}/media',
    '/ai/2/status/{id}/quotes',
    '/ai/2/search',
    '/ai/2/trends',
    '/ai/2/bsky/profile/{handle}',
    '/ai/2/bsky/profile/{handle}/statuses',
    '/ai/2/bsky/status/{handle}/{rkey}',
    '/ai/2/bsky/thread/{handle}/{rkey}',
    '/ai/2/bsky/search',
    '/ai/2/tiktok/status/{id}',
    '/ai/2/tiktok/profile/{handle}',
    '/ai/2/instagram/profile/{user}',
    '/ai/2/threads/profile/{user}',
    '/ai/2/mastodon/{domain}/profile/{handle}',
    '/ai/2/post'
  ];
  return cc.body(
    JSON.stringify(
      {
        openapi: '3.0.0',
        info: { title: 'FxEmbed AI (Markdown) API', version: '2' },
        paths: Object.fromEntries(
          paths.map(p => [p, { get: { responses: { 200: { description: 'text/markdown' } } } }])
        )
      },
      null,
      2
    ),
    200,
    {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600'
    }
  );
});

/* ---------- X / Twitter ---------- */

ai.get('/2/status/:id', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(cc, `/api/2/status/${paramOf(cc, 'id')}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdStatus(payload['status'] as Record<string, unknown>));
});

ai.get('/2/thread/:id', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(cc, `/api/2/thread/${paramOf(cc, 'id')}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdThreadDoc(payload));
});

ai.get('/2/conversation/:id', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(cc, `/api/2/conversation/${paramOf(cc, 'id')}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdConversationDoc(payload));
});

ai.get('/2/profile/:handle', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(cc, `/api/2/profile/${paramOf(cc, 'handle')}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdProfileDoc(payload));
});

ai.get('/2/profile/:handle/statuses', async c => {
  const cc = c as unknown as Ctx;
  const h = paramOf(cc, 'handle');
  const { http, payload } = await selfJson(cc, `/api/2/profile/${h}/statuses`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdSearchDoc(payload, `Posts by @${h}`, `/ai/2/profile/${h}/statuses`));
});

ai.get('/2/profile/:handle/media', async c => {
  const cc = c as unknown as Ctx;
  const h = paramOf(cc, 'handle');
  const { http, payload } = await selfJson(cc, `/api/2/profile/${h}/media`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdSearchDoc(payload, `Media by @${h}`, `/ai/2/profile/${h}/media`));
});

ai.get('/2/profile/:handle/search', async c => {
  const cc = c as unknown as Ctx;
  const h = paramOf(cc, 'handle');
  const q = new URL(cc.req.url).searchParams.get('q') ?? '';
  const { http, payload } = await selfJson(cc, `/api/2/profile/${h}/search`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(
    cc,
    200,
    mdSearchDoc(payload, `Posts by @${h} matching ${q}`, `/ai/2/profile/${h}/search`)
  );
});

ai.get('/2/status/:id/quotes', async c => {
  const cc = c as unknown as Ctx;
  const id = paramOf(cc, 'id');
  const { http, payload } = await selfJson(cc, `/api/2/status/${id}/quotes`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdSearchDoc(payload, `Quotes of ${id}`, `/ai/2/status/${id}/quotes`));
});

ai.get('/2/search', async c => {
  const cc = c as unknown as Ctx;
  const q = new URL(cc.req.url).searchParams.get('q') ?? '';
  const { http, payload } = await selfJson(cc, '/api/2/search');
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdSearchDoc(payload, `Search: ${q}`, '/ai/2/search'));
});

ai.get('/2/trends', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(cc, '/api/2/trends');
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  const items = Array.isArray(payload['trends'])
    ? (payload['trends'] as unknown[])
    : Array.isArray(payload['results'])
      ? (payload['results'] as unknown[])
      : [];
  return sendMd(cc, 200, mdList('Trends', items, null, '/ai/2/trends'));
});

/* ---------- Bluesky ---------- */

ai.get('/2/bsky/profile/:handle', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(cc, `/blueskyapi/2/profile/${paramOf(cc, 'handle')}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdProfileDoc(payload));
});

ai.get('/2/bsky/profile/:handle/statuses', async c => {
  const cc = c as unknown as Ctx;
  const h = paramOf(cc, 'handle');
  const { http, payload } = await selfJson(cc, `/blueskyapi/2/profile/${h}/statuses`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdSearchDoc(payload, `Posts by ${h}`, `/ai/2/bsky/profile/${h}/statuses`));
});

ai.get('/2/bsky/status/:handle/:rkey', async c => {
  const cc = c as unknown as Ctx;
  const h = paramOf(cc, 'handle');
  const r = paramOf(cc, 'rkey');
  const { http, payload } = await selfJson(cc, `/blueskyapi/2/status/${h}/${r}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdStatus(payload['status'] as Record<string, unknown>));
});

ai.get('/2/bsky/thread/:handle/:rkey', async c => {
  const cc = c as unknown as Ctx;
  const h = paramOf(cc, 'handle');
  const r = paramOf(cc, 'rkey');
  const { http, payload } = await selfJson(cc, `/blueskyapi/2/thread/${h}/${r}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdThreadDoc(payload));
});

ai.get('/2/bsky/search', async c => {
  const cc = c as unknown as Ctx;
  const q = new URL(cc.req.url).searchParams.get('q') ?? '';
  const { http, payload } = await selfJson(cc, '/blueskyapi/2/search');
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdSearchDoc(payload, `Bluesky search: ${q}`, '/ai/2/bsky/search'));
});

/* ---------- TikTok / Instagram / Threads / Mastodon ---------- */

ai.get('/2/tiktok/status/:id', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(cc, `/atmosphere/2/tiktok/status/${paramOf(cc, 'id')}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdStatus(payload['status'] as Record<string, unknown>, '# TikTok video'));
});

ai.get('/2/tiktok/profile/:handle', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(
    cc,
    `/atmosphere/2/tiktok/profile/${paramOf(cc, 'handle')}`
  );
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdProfileDoc(payload));
});

ai.get('/2/instagram/profile/:user', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(
    cc,
    `/atmosphere/2/instagram/profile/${paramOf(cc, 'user')}`
  );
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdProfileDoc(payload));
});

ai.get('/2/threads/profile/:user', async c => {
  const cc = c as unknown as Ctx;
  const { http, payload } = await selfJson(
    cc,
    `/atmosphere/2/threads/profile/${paramOf(cc, 'user')}`
  );
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdProfileDoc(payload));
});

ai.get('/2/mastodon/:domain/profile/:handle', async c => {
  const cc = c as unknown as Ctx;
  const d = paramOf(cc, 'domain');
  const h = paramOf(cc, 'handle');
  const { http, payload } = await selfJson(cc, `/atmosphere/2/mastodon/${d}/profile/${h}`);
  if (!isOk(payload)) return sendMd(cc, http, mdError(payload));
  return sendMd(cc, 200, mdProfileDoc(payload));
});

/* ---------- Universal: any supported social URL in, Markdown out ---------- */

ai.get('/2/post', async c => {
  const cc = c as unknown as Ctx;
  const url = new URL(cc.req.url).searchParams.get('url') ?? '';
  if (!url) {
    return sendMd(
      cc,
      400,
      '# Error\n\n> Pass `?url=` with a post or profile URL, e.g. `/ai/2/post?url=https://x.com/X/status/20`.'
    );
  }
  const r = resolveSocialUrl(url);
  if (!r.json || r.error) {
    return sendMd(cc, 400, `# Error\n\n> ${r.error ?? 'URL not recognized.'}`);
  }
  const { http, payload } = await selfJson(cc, r.json);
  if (!isOk(payload)) return sendMd(cc, http, `# ${r.label ?? 'Post'}\n\n${mdError(payload)}`);
  if (payload['status']) {
    return sendMd(
      cc,
      200,
      `# ${r.label ?? 'Post'}\n\n${mdStatus(payload['status'] as Record<string, unknown>, '').replace(/^# Post\n\n/, '')}`
    );
  }
  if (payload['user'] || payload['author'])
    return sendMd(
      cc,
      200,
      `# ${r.label ?? 'Profile'}\n\n${mdProfileDoc(payload).replace(/^# Profile\n\n/, '')}`
    );
  if (Array.isArray(payload['results'])) {
    return sendMd(cc, 200, mdSearchDoc(payload, r.label ?? 'Results', '/ai/2/post'));
  }
  return sendMd(
    cc,
    200,
    `# ${r.label ?? 'Result'}\n\n${mdError({ code: 200, message: 'Unrecognized payload shape.' })}`
  );
});

ai.all('*', c => {
  return sendMd(
    c as unknown as Ctx,
    404,
    '# Error\n\n> Unknown /ai route. See `/ai/` and `/llms.txt`.'
  );
});
