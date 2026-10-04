/* llms.txt - the complete machine-readable guide to this FxEmbed worker.
   Served at /llms.txt, /llm.txt and /ai/llms.txt. */

export const llmsTxt = (base: string): string => `# FxEmbed worker - complete LLM guide (llms.txt)

THIS FILE IS THE MANUAL. An AI agent that reads this file knows everything needed to use this worker.

Base URL of THIS deployment: ${base}
Live copies of this guide: ${base}/llms.txt  ${base}/llm.txt  ${base}/ai/llms.txt (all identical, this file self-fills the base URL)
Machine-readable route lists (OpenAPI 3.0 JSON): ${base}/api/2/openapi.json  ${base}/blueskyapi/2/openapi.json  ${base}/atmosphere/2/openapi.json  ${base}/ai/2/openapi.json
Test console (human UI trying every endpoint): https://fxembed-console.pages.dev

WHAT THIS IS: FxEmbed turns social-media posts into rich chat embeds plus JSON APIs. No signup, no API key. Every example below uses BASE = ${base} and a User-Agent header: curl -H "User-Agent: MyAgent/1.0" "BASE<path>".
NETWORKS: X/Twitter, Bluesky, TikTok, Instagram, Threads, ANY Mastodon/ActivityPub instance.
NOT SUPPORTED: Reddit, Facebook, YouTube, TikTok comments/likers/follow-lists/keyword-search/trends (ByteDance signs those APIs; only public server-rendered pages are readable).

================================================================
SECTION A - HOW TO CALL (rules every agent must follow)
================================================================

A1. REALM PREFIXES. On *.workers.dev (this host) each realm needs its path prefix. On custom domains each realm drops its prefix.
  /api/...         FxTwitter JSON API v2 (17 OpenAPI paths) + legacy v1
  /twitter/...     tweet/profile embed pages, RSS/Atom feeds, ActivityPub, oEmbed
  /blueskyapi/...  FxBluesky JSON API v2 (15 OpenAPI paths)
  /bluesky/...     Bluesky post embeds, feeds, oEmbed
  /tiktok/...      TikTok pages, /api/, /raw/, /proxy, oEmbed
  /instagram/...   /p/, /reel/, /api/, oEmbed
  /atmosphere/...  multi-provider JSON: Mastodon, TikTok, Instagram, Threads (+ forwards)
  /ai/...          Markdown twins of the JSON APIs (Section B). Content-Type: text/markdown.

A2. USER-AGENT IS MANDATORY for /api, /blueskyapi, /atmosphere and /ai. Any descriptive value works; missing UA = HTTP 401 JSON {"error":"You must identify yourself..."}. Browsers send theirs automatically. WARNING: bare library defaults like Python-urllib/3.11 may be challenged at the edge with 403 - always set a real app UA string.

A3. EMBED HTML NEEDS A BOT UA (Discordbot/2.0, Telegrambot, facebookexternalhit, WhatsApp...). With a browser UA, embed routes answer 302 redirect to the original site instead of HTML. JSON APIs accept any UA.

A4. PAGINATION. List endpoints return {"code":200,"results":[...],"cursor":{"top":"...","bottom":"..."}}. Recipe: GET /api/2/profile/X/statuses?count=5 -> read cursor.bottom -> GET same path + ?cursor=BOTTOM (repeat; keep other params). Cursors are opaque - never build them yourself. count range is 1-100 (default 20, search default 30).

A5. POLLING WITH ?since=. Timelines accept ?since=<unix SECONDS>. If nothing is newer the worker answers HTTP 204 with an empty body (cheapest possible poll). Else it returns the timeline and you filter client-side. Ideal loop: statuses?count=5&since=<last_seen> every N minutes; RSS feeds (Section D) are the alternative.

A6. ?lang=xx translates post text inline where supported (ISO 639-1/BCP 47, e.g. ?lang=es). Works on status/thread/conversation/statuses/search/quotes endpoints.

A7. ERRORS are envelopes {"code":N,"message":"..."} AND the same N as HTTP status. 404 envelope = valid answer meaning "upstream has nothing" (empty search, unknown id, deleted post). 8 X routes need a credential pool THIS worker lacks - they 500/404 here but 200 on api.fxtwitter.com (list in K7).

A8. CONTENT TYPES. JSON APIs: application/json. /ai: text/markdown. Embeds: text/html. Feeds: application/rss+xml / atom+xml. oEmbed: application/json. robots/version: text. CORS: Access-Control-Allow-Origin: * on JSON + AI + embed realms, so browser apps can call directly.

A9. RATE / FRESHNESS REALITY. Success responses are edge-cached: single posts/profiles/search ~30 days, threads/timelines/conversations ~7 days, oEmbed ~1 day; cache is purged when a post goes private/deleted. So: single-post endpoints can serve stale stats; always poll TIMELINES with ?since= for freshness. TikTok: a handful of unsigned requests per IP, then a long 429 cooldown (expect 404 flaps - space out calls).

================================================================
SECTION B - /ai MARKDOWN API (LLM-first twins, start here for AI work)
================================================================

Same data as JSON, rendered as stable token-lean Markdown. Layout contract:
  "# Post" then "**Author Name** · date · [open](url)" then blockquoted FULL text (never truncated),
  then "Stats: 12K likes · 3K reposts · ..." (only nonzero), then "Media: ![photo](url) | [video 12s](url)",
  then optional "Replying to: ...", "Link card: ...", "Community note: ...".
  Threads render "## 1/N, 2/N..." sections. Profiles render "**Name** — N followers · ..." + bio lines + [open profile]. Lists render numbered one-liners + a copy-paste "Next: \`/ai/...?cursor=...\`" line when more pages exist. Errors render "# Error" + upstream code + 3 fix tips. No UA = 401 markdown doc. All JSON query params (count/cursor/lang/ranking_mode/...) work identically.
REAL EXAMPLE (GET /ai/2/status/20):
  # Post
  **jack** · Tue Mar 21 20:50:14 +0000 2006 · [open](https://x.com/jack/status/20)
  > just setting up my twttr
  Stats: 311K likes · 124.7K reposts · 18.1K replies · 7.2K quotes · 21.8K bookmarks

B1. X endpoints. /ai/2/status/{tweet-id} | /ai/2/thread/{tweet-id} (whole author thread) | /ai/2/conversation/{tweet-id} (+?ranking_mode=likes|recency) | /ai/2/profile/{handle-or-id:123} | /ai/2/profile/{handle}/statuses (+?count&cursor&with_replies&lang) | /ai/2/profile/{handle}/search?q= | /ai/2/profile/{handle}/media | /ai/2/status/{id}/quotes | /ai/2/search?q=&feed=latest|top|media | /ai/2/trends

B2. Bluesky endpoints. /ai/2/bsky/profile/{handle-or-DID} | /ai/2/bsky/profile/{handle}/statuses | /ai/2/bsky/status/{handle}/{rkey} | /ai/2/bsky/thread/{handle}/{rkey} | /ai/2/bsky/search?q=. NO RKEY? Three-step recipe: 1) GET /ai/2/bsky/profile/bsky.app/statuses?count=1 2) copy .../post/{rkey} from the [open] link 3) GET /ai/2/bsky/status/bsky.app/{rkey}.

B3. Other networks. /ai/2/tiktok/status/{numeric-video-id} | /ai/2/tiktok/profile/{handle-without-@} | /ai/2/instagram/profile/{username} | /ai/2/threads/profile/{username} | /ai/2/mastodon/{instance-domain}/profile/{handle}

B4. UNIVERSAL - /ai/2/post?url=. Paste ANY supported post/profile URL, get Markdown. ONE endpoint for everything. Recognized shapes:
  x.com|twitter.com/{handle}/status/{id} -> X post        | x.com|twitter.com/{handle} -> X profile
  bsky.app/profile/{handle}/post/{rkey} -> Bsky post      | bsky.app/profile/{handle} -> Bsky profile
  tiktok.com/.../video/{numeric-id} -> TikTok video       | tiktok.com/@{handle} -> TikTok profile
  instagram.com/p|reel|reels/{shortcode} -> IG post       | instagram.com/{username} -> IG profile
  threads.com|threads.net/@{user}/post/{id} -> Threads post | threads.com|threads.net/@{user} -> Threads profile
  {mastodon-host}/@{handle}/{id} | /users/{handle}/statuses/{id} | /notice/{id} -> Mastodon post
  {mastodon-host}/@{handle} | /users/{handle} -> Mastodon profile
  Anything else -> HTTP 400 markdown explaining supported shapes. Missing ?url= -> HTTP 400.
  EXAMPLES: /ai/2/post?url=https://x.com/X/status/20 | ?url=https://bsky.app/profile/bsky.app | ?url=https://mastodon.social/@Gargron | ?url=https://www.threads.com/@zuck

B5. Meta. /ai/ (index of all AI routes) /ai/version /ai/robots.txt /ai/llms.txt (this guide) /ai/2/openapi.json (stub spec listing the 21 AI paths).

================================================================
SECTION C - X/TWITTER JSON API (/api/2/...) - all 17 paths + extras
================================================================

C1. Single posts. GET /api/2/status/{tweet-id} -> {"code":200,"status":{...},"thread":null,"author":{...}}. Numeric id only (that is the digits in x.com/.../status/123). Deleted/protected/unknown id -> 404 envelope. +?lang= +?about_account=1 (appends extended account block).
C2. Threads. GET /api/2/thread/{id} -> same envelope with "thread" holding the author's connected posts in order. Use for unroll/archive.
C3. Conversations. GET /api/2/conversation/{id}?ranking_mode=likes|recency|relevance&cursor=&lang= -> post + ancestors + paginated direct replies. DEAD for logged-out everywhere (404 here AND on production - X shut the guest path, verified Oct 2026). Use /thread/{id} (author chain, works) + /status/{id}/quotes (works via relay) instead.
C4. Profile. GET /api/2/profile/{handle} - handle OR id:123 numeric form. -> {"code":200,"user":{author-shaped}}. +?about_account=1.
C5. Profile about. GET /api/2/profile/{handle}/about -> extended/billing-adjacent account data. NEEDS pool (404 here).
C6. Timelines. GET /api/2/profile/{handle}/{statuses|media|articles|followers|following}?count=1-100&cursor=&with_replies=1&groupthreads=1&since=&lang= -> {"results":[],"cursor":{}}. statuses works fully here; media/articles/followers/following NEED the pool (500 here). groupthreads=1 clusters timeline items into threads. with_replies=1 includes replies. Relay fallback: guest 404/empty timelines retry via profile RSS tabs (media/with_replies mapped), later pages walk from: windows.
C7. Reposts/quotes. GET /api/2/status/{id}/{reposts|quotes}?count=&cursor=&lang=. quotes works when upstream has data (else 404 envelope); reposts NEEDS pool (500 here). Relay fallback: empty quotes retry via quoted_tweet_id: relay search.
C8. Search. GET /api/2/search?q=&feed=latest|top|media&count=&cursor=&lang=. Served by the search relay (RSS discovery + per-post hydration): all X operators pass through (from:, filter:, lang:, since:, min_faves:, ...). Pagination walks since:/until: time windows via the opaque cursor.bottom (no X cursors). feed=media appends filter:media; top behaves like latest. Empty = 404 envelope. People search (/search/users) stays removed - no relay surface for it. GET /api/2/profile/{handle}/search?q=&feed=&count=&cursor=&lang= is ours-only per-user search (relay profile search + windows).
C9. People/typeahead/trends. GET /api/2/typeahead?q=exa&result_type=&src= and GET /api/2/trends?type=trending&count= NEED pool (404 here, 200 on production).
C10. Utilities. GET /api/2/owoembed?url={post-url} (oEmbed JSON: title/author/html). GET /api/2/hit?link= (click ping, 204). GET /api/2/go (redirect helper). GET /api/robots.txt. Legacy v1: GET /api/status/{id} and GET /api/{handle} (old embed-style JSON/HTML).
C11. STATUS OBJECT FIELDS (exact keys): id, text, raw_text, lang, created_at, created_timestamp (seconds), likes, reposts, replies, quotes, bookmarks, views, url, source, replying_to (handle or null), reposted_by, is_note_tweet, community_note ({text} or null), embed_card ("tweet"|{title,url,...}|null), media {photos:[{url,width,height}], videos:[{url,thumbnail,duration,variants:[{url}]}], gifs:[same as videos]}, author {id,name,screen_name,description,raw_description,location,website,followers,following,likes,statuses,media_count,joined,protected,verification|verified,avatar_url,banner_url,url}, provider ("twitter"). Threads may embed tombstone placeholders for deleted/private posts instead of full objects.

================================================================
SECTION D - X EMBEDS + FEEDS (/twitter/...)
================================================================

D1. GET /twitter/{handle}/status/{id} and GET /twitter/{handle} -> embed HTML for Discord/Telegram. BOT UA REQUIRED (else 302 to x.com). Contains OpenGraph/Twitter-card meta, video player, poll, quote, translation fragments.
D2. FEEDS (best polling primitive, any UA): GET /twitter/{handle}/feed.xml (RSS) | /twitter/{handle}/feed.atom.xml (Atom) | /twitter/{handle}/media.xml (media-only RSS) | /twitter/{handle}/media.atom.xml. Poll with If-None-Match / If-Modified-Since.
D3. GET /twitter/api/v1/statuses/{id} -> ActivityPub JSON view of a tweet (federation-friendly).
D4. GET /twitter/owoembed?url={post-url} (oEmbed). GET /twitter/version (health/version page). GET /twitter/robots.txt. /twitter/hashtag/{tag} and /twitter/i/events/... are redirect demos.

================================================================
SECTION E - BLUESKY (/blueskyapi/2/... + /bluesky/...)
================================================================

E1. JSON (15 paths, same conventions as Section C incl. cursor/count/lang/since): status/{handle}/{rkey} | thread/{handle}/{rkey} | conversation/{handle}/{rkey} | status/{handle}/{rkey}/{reposts,likes} | profile/{handle} | profile/{handle}/{statuses,media,followers,following,likes} | search?q= | search/users?q= | typeahead?q= | trends. Handle may be bare (bsky.app) or did:plc:.... Items add at_uri + cid keys. likes endpoints need upstream auth (expect 4xx - by design, same on production). search?q= works: the public AppView edge-403s searchPosts from datacenter IPs, so the worker retries api.bsky.app automatically (production lacks that retry and answers 500 there). profile/{handle}/media excludes replies by default (?with_replies=1 to include them). External link-card thumbnails surface as image media.
E2. RKEY RECIPE (rkey = post id): statuses?count=1 -> results[0].url ends .../post/{rkey} -> use in status/thread/conversation/reposts/likes paths.
E3. Embeds (/bluesky/...): /bluesky/profile/{h}/post/{rkey} (bot UA for HTML) | /bluesky/profile/{h}/post/{rkey}/photo/{N} embeds only the Nth photo (N>=1, same /photo/N convention as X) | /bluesky/profile/{h}/feed.xml (RSS) | /bluesky/owoembed?url= | /bluesky/version.

================================================================
SECTION F - TIKTOK (/tiktok/... + /atmosphere/2/tiktok/...)
================================================================

F1. Realm pages: /tiktok/@{handle}/video/{numeric-id} (embed HTML, bot UA) | /tiktok/t/{shortcode} | /tiktok/api/{id} + /tiktok/raw/{id} (JSON: id,url,text,author{name,screen_name,avatar},likes,reposts,replies,views,media) | /tiktok/oembed?url= | /tiktok/proxy?url={video-url} (byte proxy; payload media URLs point at the serving host) | /tiktok/version.
F2. Atmosphere JSON: /2/tiktok/status/{id} | /2/tiktok/profile/{handle} | /2/tiktok/profile/{handle}/statuses | /2/tiktok/hashtag/{tag} | /2/tiktok/music/{id}.
F3. HARD LIMITS: only NUMERIC video ids work server-side; unsigned calls are IP-limited (a handful, then a long 429 cooldown surfacing as 404 - space out calls, never retry-loop); NO comments/likers/follow-lists/keyword-search/typeahead/trends exist (unsigned ByteDance APIs return empty 200s by design).

================================================================
SECTION G - INSTAGRAM (/instagram/... + /atmosphere/2/instagram/...)
================================================================

G1. Realm: /instagram/p/{shortcode} | /instagram/reel/{shortcode} | /instagram/api/{shortcode} (JSON) | /instagram/raw/{shortcode} | /instagram/owoembed?url= | /instagram/version. Invalid shortcodes -> 400 with reason. Telegram UA on a video post gets a 302 straight to the video file (embed container skipped; api/text-only/gallery/instant-view flags unchanged).
G2. Atmosphere JSON: /2/instagram/status/{id} | /2/instagram/profile/{user} | /2/instagram/profile/{user}/{statuses,videos,conversation/{cid},tagged,stories,followers,following} | /2/instagram/status/{id}/likes | /2/instagram/search/users?q= | /2/instagram/typeahead?q=.
G3. REALITY: logged-out Instagram is heavily blocked upstream - 500 envelopes are NORMAL and mirror production byte-for-byte. likers/follows/tagged/stories/user-search/typeahead are proxy-only: 501 without an Instagram account pool.

================================================================
SECTION H - THREADS (/atmosphere/2/threads/...) - 14 routes
================================================================

status/{id} | status/{id}/likes | profile/{user} | profile/{user}/{statuses,replies,reposts,media,followers,following} | conversation/{id} | search?q= | search/users?q= | trends | typeahead?q=. Post/profile/timeline/conversation prefer the account proxy and fall back to logged-out; search/typeahead/trends/likes/follows/replies/reposts/media tabs are proxy-only (501 without credentials).

================================================================
SECTION I - MASTODON / ACTIVITYPUB (/atmosphere/2/mastodon/{domain}/...) - 12 routes, needs nothing
================================================================

status/{id} | status/{id}/{reposts,likes} | thread/{id} | conversation/{id} | search?q= | search/users?q= | profile/{handle} | profile/{handle}/{followers,following,media,statuses}. {domain} = any instance (mastodon.social, ...). Profile screen_names may render as handle@domain. search?q= answers 200 with results:[] for statuses - Mastodon only serves status search to authenticated callers, so an empty page is the true upstream answer (search/users?q= DOES return hits anonymously). URL shapes for /ai/2/post?url=: /@{h}/{id}, /users/{h}/statuses/{id}, /notice/{id}, /@{h}, /users/{h}.

================================================================
SECTION J - ATMOSPHERE MISC
================================================================

J1. Forwards /atmosphere/2/twitter/* and /2/bluesky/* re-dispatch to the Twitter/Bluesky APIs. QUIRK: they 404 on *.workers.dev (the internal path keeps the /atmosphere prefix) - use /api + /blueskyapi directly there; forwards work on custom domains.
J2. /atmosphere/ carries the SAME /proxy TikTok route as the TikTok realm. /atmosphere/ root explains the service; /atmosphere/2/openapi.json lists all 43 paths.

================================================================
SECTION K - HIDDEN HACKS AND BEHAVIORS (the non-obvious list)
================================================================

K1. cursor.bottom loop (Section A4) is the ONLY pagination primitive - works on timelines, search, reposts, quotes, followers.
K2. ?since=<unix-sec> + HTTP 204 = cheapest change-detection on ANY timeline.
K3. ?lang= translates inline (status/thread/conversation/statuses/search/quotes).
K4. ?about_account=1 appends extended account data to X status/thread/profile calls.
K5. ?groupthreads=1 clusters an X timeline into thread groups; ?with_replies=1 includes replies.
K6. id:123 addresses X users by numeric id anywhere a {handle} goes.
K7. Credential-gated on THIS worker (mirror-production-200 elsewhere): X profile/{media,articles,followers,following,about}, status/{id}/reposts, typeahead, trends. conversation/ is dead on production too - not pool-fixable.
K8. TikTok 429-cooldown flaps as 404 on every host including production - back off, do not hammer.
K9. Bot UA gets embed HTML; browser UA gets 302 (embeds) or normal JSON (APIs). Test embeds with: curl -H "User-Agent: Discordbot/2.0".
K10. /error route: returns 200 + branded HTML for bot UAs, empty 400 otherwise (worker fallback page).
K11. version endpoints in EVERY realm double as health checks. robots.txt in twitter/api realms.
K12. Feed the three openapi.json URLs to any OpenAPI codegen to build typed clients instantly.
K13. thread/ = author's connected posts; conversation/ = post + ancestors + replies. Different calls, different jobs.
K14. Deleted/private posts inside threads surface as tombstone placeholders, not errors - handle missing "text".
K15. oEmbed works in all four embed realms with just ?url= (no auth, no UA games for the JSON form).
K16. Telegram UA behaviors: X photos served as the name=large variant; IG video posts 302 straight to the video file.
K17. Non-Discord embeds prefix replies with "↩ Display Name (@handle)" (bare @handle when the account has no display name).
K18. X search relay: discovery fetches the relay RSS (retry-once; flakes possible), hydration rebuilds each id via TweetDetail (x5 parallel, drops failures), pages walk since:/until: windows in the opaque cursor, RSS limits apply (tweets only, ~20/window, stats come from hydration). Root overridable via X_SEARCH_RELAY_ROOT.
K19. Fallbacks: profile statuses/media/replies + quotes retry via relay when the guest flow 404s or returns empty (primary kept when relay also misses); profile search/rss powers the ours-only /profile/{handle}/search route. id:123 forms never relay (screen names only).

================================================================
SECTION L - ERROR CATALOG
================================================================

401 (no UA): {"error":"You must identify yourself with a User-Agent header..."} -> add -H "User-Agent: MyAgent/1.0". 403 with default library UAs: edge challenge -> use a descriptive UA. 404 envelope {"code":404,"message":"..."}: upstream empty/unknown/deleted - usually the ANSWER, not a bug. 500 envelope: upstream failure OR missing credential pool (Section K7) OR logged-out Instagram block. 501: proxy-only route without account pool (IG/Threads gated lists). 503: Bluesky upstream unavailable (retry). 204: ?since= found nothing new (poll again later). /ai mirrors all of these 1:1 as "# Error" docs.

================================================================
SECTION M - AGENT COOKBOOK (copy-paste, BASE=${base})
================================================================

M1. Fastest LLM answer to any link: GET BASE/ai/2/post?url=<urlencoded-post-url>
M2. Monitor an account: loop GET BASE/api/2/profile/X/statuses?count=5&since=<last-unix> (204 = nothing new). Or poll BASE/twitter/X/feed.xml.
M3. Unroll + archive: GET BASE/ai/2/thread/20 -> Markdown transcript with stats + media links.
M4. Both sides of a debate: GET BASE/ai/2/thread/20 (author side) + BASE/ai/2/status/20/quotes (reactor side via relay).
M5. Bluesky deep read: statuses?count=1 -> rkey -> BASE/ai/2/bsky/status/bsky.app/{rkey} and .../thread/.../....
M6. Keyword search + people map: BASE/api/2/search?q=&feed=&count= -> follow cursor.bottom (time-window pages). Per-user: BASE/api/2/profile/{handle}/search?q=. People search has no relay surface - start from a known handle -> BASE/api/2/profile/{handle}/statuses?count=5.
M7. Trend radar: cron on BASE/api/2/trends + BASE/api/2/typeahead?q=<seed> (needs pool here; works on production).
M8. Cross-network person check: /ai/2/post?url= once per profile URL (X + Bsky + Mastodon + Threads + IG + TikTok).
M9. Link previews for chat: BASE/api/2/owoembed?url=<url> (JSON card with title/author/html).
M10. Full-fidelity pipeline: JSON API for machines (/api...), /ai Markdown for reasoning, RSS for triggers, oEmbed for previews.

================================================================
SECTION N - LIMITS (do not retry-loop)
================================================================

No Reddit/Facebook/YouTube. No TikTok comments/likers/search. Synthetic ids (quote misses) 404 BY DESIGN. Instagram 500s mirror production. TikTok hashtag/music flap under rate limits everywhere. /ai error docs ARE the final answer when upstream has nothing. This worker has no Twitter/X credential pool (K7); everything else runs fully logged-out.
`;
