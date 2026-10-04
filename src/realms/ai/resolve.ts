/* Map any supported social URL to this worker's internal JSON path.
   Returns { json, label } or { error } when the URL isn't recognized. */

export interface Resolved {
  json?: string;
  label?: string;
  error?: string;
}

const id = '([0-9]+)';
const handle = '([A-Za-z0-9_]{1,15})';

export const resolveSocialUrl = (raw: string): Resolved => {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: 'Not a valid URL. Pass ?url=https://x.com/handle/status/123…' };
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');

  let m: RegExpMatchArray | null;
  // X / Twitter post
  if (
    (m = path.match(new RegExp(`^/${handle}/status/${id}$`))) &&
    /(^|\.)(twitter|x)\.com$/.test(host)
  ) {
    return { json: `/api/2/status/${m[2]}`, label: `X post ${m[2]}` };
  }
  // X / Twitter profile
  if ((m = path.match(new RegExp(`^/${handle}$`))) && /(^|\.)(twitter|x)\.com$/.test(host)) {
    return { json: `/api/2/profile/${m[1]}`, label: `X profile @${m[1]}` };
  }
  // Bluesky post
  if ((m = path.match(/^\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)$/)) && host === 'bsky.app') {
    return { json: `/blueskyapi/2/status/${m[1]}/${m[2]}`, label: `Bluesky post ${m[2]}` };
  }
  // Bluesky profile
  if ((m = path.match(/^\/profile\/([^/]+)$/)) && host === 'bsky.app') {
    return { json: `/blueskyapi/2/profile/${m[1]}`, label: `Bluesky profile ${m[1]}` };
  }
  // TikTok video (numeric id)
  if ((m = path.match(new RegExp(`/video/${id}$`))) && /(^|\.)tiktok\.com$/.test(host)) {
    return { json: `/atmosphere/2/tiktok/status/${m[1]}`, label: `TikTok video ${m[1]}` };
  }
  // TikTok profile
  if ((m = path.match(/^\/@([^/]+)$/)) && /(^|\.)tiktok\.com$/.test(host)) {
    return { json: `/atmosphere/2/tiktok/profile/${m[1]}`, label: `TikTok @${m[1]}` };
  }
  // Instagram post / reel
  if (
    (m = path.match(/^\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)) &&
    /(^|\.)instagram\.com$/.test(host)
  ) {
    return { json: `/atmosphere/2/instagram/status/${m[1]}`, label: `Instagram post ${m[1]}` };
  }
  // Instagram profile
  if ((m = path.match(/^\/([A-Za-z0-9_.]{1,30})$/)) && /(^|\.)instagram\.com$/.test(host)) {
    return { json: `/atmosphere/2/instagram/profile/${m[1]}`, label: `Instagram @${m[1]}` };
  }
  // Threads post
  if (
    (m = path.match(/^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/)) &&
    /(^|\.)threads\.(com|net)$/.test(host)
  ) {
    return { json: `/atmosphere/2/threads/status/${m[2]}`, label: `Threads post ${m[2]}` };
  }
  // Threads profile
  if ((m = path.match(/^\/@([^/]+)$/)) && /(^|\.)threads\.(com|net)$/.test(host)) {
    return { json: `/atmosphere/2/threads/profile/${m[1]}`, label: `Threads @${m[1]}` };
  }
  // Mastodon / Fediverse post: /@handle/id, /users/handle/statuses/id, /notice/id, /p/id
  if (
    (m = path.match(/^\/@([^/]+)\/([0-9]+)$/)) ||
    (m = path.match(/^\/users\/([^/]+)\/statuses\/([0-9]+)$/)) ||
    (m = path.match(/^\/(?:notice|p)\/([0-9A-Za-z_-]+)$/))
  ) {
    const statusId = m[2] ?? m[1];
    return {
      json: `/atmosphere/2/mastodon/${host}/status/${statusId}`,
      label: `Mastodon post ${statusId}`
    };
  }
  // Mastodon / Fediverse profile: /@handle or /users/handle
  if ((m = path.match(/^\/@([^/]+)$/)) || (m = path.match(/^\/users\/([^/]+)$/))) {
    return { json: `/atmosphere/2/mastodon/${host}/profile/${m[1]}`, label: `Mastodon @${m[1]}` };
  }
  return {
    error:
      'URL not recognized. Supported: x.com / twitter.com (post, profile), bsky.app (post, profile), ' +
      'tiktok.com (video, profile), instagram.com (p/reel, profile), threads.com (post, profile), ' +
      'any Mastodon/ActivityPub instance (post, profile).'
  };
};
