# fxembed-worker

Production X / Bluesky / Mastodon / Threads / Instagram / TikTok embed + API worker, with an
agent-first Markdown API (`/ai` + `/llms.txt`) and a search relay that brings back X keyword
search without credentials.

**Live deployment:** <https://fixtweet.twapiworker.workers.dev>
**Agent guide (live):** <https://fixtweet.twapiworker.workers.dev/llms.txt>
(same content at `/llm.txt` and `/ai/llms.txt`)

> Fork base: [FxEmbed/FxEmbed](https://github.com/FxEmbed/FxEmbed) @ `b7970b5` (2026-09-25),
> plus 12 upstream fixes cherry-picked from `origin/main` (Bluesky media feeds, single-photo
> embeds, Telegram variants, xctid, …). MIT license kept, see [LICENSE.md](LICENSE.md).

## What this fork adds over upstream

| Addition                                                                   | Where                                                    | Status       |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | ------------ |
| `/ai` realm: Markdown twin of every read route (LLM-optimized)             | `src/realms/ai/`                                         | Live, tested |
| `/llms.txt` agent manual (served from code, mirrored at repo root)         | `src/realms/ai/llms.ts`, `llms.txt`                      | Live, tested |
| X search relay: RSS discovery + per-post hydration (no pool needed)        | `packages/atmosphere/src/providers/twitter/rssSearch.ts` | Live, tested |
| Ours-only per-user search `GET /api/2/profile/{handle}/search` (+ AI twin) | api + ai routers                                         | Live, tested |
| Relay fallbacks for profile statuses/media/replies + quotes                | `src/realms/api/routes/twitter.ts`                       | Live, tested |
| Bluesky `api.bsky.app` retry (public AppView 403s search from datacenters) | `packages/atmosphere/.../bluesky/`                       | Live, tested |

Removed (dead upstream, verified on production too): `GET /api/2/search/users`
(X people search has no relay surface).

## Architecture

```
src/worker.ts                  Hono app, realm dispatch (partly by Host header)
src/realms/api/                FxTwitter JSON API v2 (/api/2/..., OpenAPI)
src/realms/ai/                 Markdown twins (/ai/2/...) + /llms.txt
src/realms/{twitter,bluesky,tiktok,instagram}/   oEmbed/redirect/feed realms
src/realms/bluesky-api/        /blueskyapi/2/... JSON
src/realms/atmosphere/         multi-provider fan-out (/atmosphere/2/...)
packages/atmosphere/           providers, transports, GraphQL (built first)
```

Transports: `public` (logged-out) | `anonymous-proxy` (credential pool) |
`proxy-relay` (forward to another host's OpenAPI). This deployment ships **no credential
pool**, so pool-gated routes answer 404/500/501 by design (see matrix).

Host routing note: `api.*` hosts rewrite `/ai/*` into `/api/*` — the `/ai` realm lives on
the worker host itself (`workers.dev`, `fxtwitter.com`, …), never on `api.*` hosts.

## Endpoint matrix (verified live)

X JSON (`/api/2/`): status, thread, profile (+`id:123`), statuses, media, quotes,
**search (relay)**, **profile search (ours-only)**, owoembed, hit, go, robots.txt,
openapi.json → 200. typeahead, trends → 404 (need pool). reposts, articles,
followers/following, likes, about → 500/404 (need pool; production fails most too).
search/users → removed. conversation → 404 everywhere (X shut the guest path).

X search relay: `q` (all X operators pass through), `feed=latest|top|media`
(`top` = latest, `media` appends `filter:media`), `count`, `lang` (appends `lang:`),
opaque `cursor.bottom` walks `since:/until:` time windows (~20/window, dedupe by id).
Empty = 404 envelope.

Other realms: Bluesky search/profile/status/feeds → 200 (search via api.bsky.app retry);
Mastodon users/conversation → 200 (keyword search 200-empty: upstream returns nothing
anonymously); Threads/Instagram logged-out reads where X/Meta allow, proxy routes 501;
TikTok embeds where unsigned endpoints answer.

Embeds need a bot User-Agent (`Discordbot/2.0`); humans get redirected to the platform.
`/ai` needs any `User-Agent` header (else 401 usage doc).

## Setup

Prereqs: Node.js 24 LTS, a Cloudflare account, Wrangler.

```powershell
npm install
Copy-Item wrangler.example.toml wrangler.toml   # then set account_id / routes
Copy-Item .env.example .env                     # then fill values (table below)
npm run build:atmosphere   # 1. compile packages/atmosphere
npm run build-local        # 2. bundle dist/worker.js
npm run deploy             # 3. wrangler deploy
```

Key environment variables (`.env.example` documents all):

| Var                                     | Default                          | Purpose                                                 |
| --------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| `API_HOST_LIST`                         | `api.fxtwitter.com,…`            | Hosts serving the JSON API realm                        |
| `TWITTER_ROOT`                          | `https://x.com`                  | Canonical X origin                                      |
| `INSTAGRAM_ROOT` / `INSTAGRAM_API_ROOT` | …instagram.com / i.instagram.com | IG origins                                              |
| `X_SEARCH_RELAY_ROOT`                   | `https://nitter.kareem.one`      | Search/profile RSS relay origin (override to self-host) |
| `SENTRY_DSN`                            | empty                            | Error reporting (empty = off)                           |

`credentials.enc.json` is optional (empty pool = logged-out only; build continues).
`branding.json` auto-copies from `branding.example.json`.

Live logs: `npx wrangler tail fixtweet --format json` (via `cmd.exe` redirect, the
`npx` binary cannot be `Start-Process`-ed directly on Windows).

## Testing

```powershell
npm run lint:eslint   # must exit 0 (prettier endOfLine:lf; repo files are CRLF on disk -
                      # run `npm run prettier` first after a fresh clone, then revert
                      # unrelated reformatting: docker-compose.yml, test/mocks/**)
npm run test          # 66 files / 418 tests (Miniflare + mocks, no credentials needed)
```

Test conventions: route tests call `app.request(url, init, harness)`; third-party fetches
are stubbed with `vi.spyOn(globalThis, 'fetch')`; `/ai` tests must use a workers.dev-style
host plus an `ExecutionContext` shim (`{ waitUntil(){}, passThroughOnException(){} }`)
because the self-JSON bridge re-enters `app.request`.

## The search relay (how + limits + etiquette)

`rssSearchAPI` fetches relay RSS (`/search/rss`, `/{handle}/rss|/media/rss|/with_replies/rss`,
`/{handle}/search/rss`), parses items with entity-decode + ghost-skip, then hydrates each id
through our own TweetDetail path (×5 parallel, failures dropped) → full envelopes with
stats/media/facets. Pagination encodes `{until, seen[]}` base64url (Workers-core codec —
**never use `Buffer`**: no `nodejs_compat` flag, tests won't catch it).

Limits: tweets only (~20/window), no people search, volunteer origin (~1-in-10 flake,
retried once), polite `FxEmbed/…-search-relay` UA. Override the origin with
`X_SEARCH_RELAY_ROOT` (ideally your own Nitter with your own X sessions).

## Agent docs

`src/realms/ai/llms.ts` is the single source of `/llms.txt`; `llms.txt` at repo root is a
manual mirror — edit both. Line prefixes are stable contracts (`A`uth, `B` AI realm,
`C` X API, `E` Bluesky, `F` TikTok, `G` IG, `H` Threads, `I` Mastodon, `J` Atmosphere,
`K` hacks, `M` cookbook, `N` limits). Watch out: the file is a TS template literal —
backticks inside must stay escaped as `` \` ``.

## License

MIT, see [LICENSE.md](LICENSE.md). Upstream project by dangered wolf and contributors —
https://github.com/FxEmbed/FxEmbed.
