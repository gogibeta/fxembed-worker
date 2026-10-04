/* Markdown renderers for the /ai realm.
   Token-lean, LLM-first: stable headings, full text, no nulls, no duplicate
   fields, media as links, pagination as a copy-paste "Next:" line. */

const num = (v: unknown): string => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${v}`;
};

const line = (...parts: (string | undefined | null)[]): string =>
  parts.filter(p => p !== undefined && p !== null && p !== '').join(' ');

const esc = (s: unknown): string => (typeof s === 'string' ? s.replace(/\r/g, '') : '');

const isStatus = (o: unknown): o is Record<string, unknown> =>
  typeof o === 'object' &&
  o !== null &&
  (typeof (o as Record<string, unknown>)['text'] === 'string' ||
    typeof (o as Record<string, unknown>)['raw_text'] === 'string');

const isUser = (o: unknown): o is Record<string, unknown> =>
  typeof o === 'object' &&
  o !== null &&
  typeof (o as Record<string, unknown>)['screen_name'] === 'string' &&
  !isStatus(o);

const authorTag = (a: unknown): string => {
  if (typeof a !== 'object' || a === null) return '';
  const r = a as Record<string, unknown>;
  const name = esc(r['name']) || esc(r['screen_name']);
  const handle = esc(r['screen_name']);
  return handle && name !== handle ? `${name} (@${handle})` : name || (handle ? `@${handle}` : '');
};

const statsLine = (s: Record<string, unknown>): string => {
  const parts: string[] = [];
  const push = (v: unknown, label: string) => {
    const n = num(v);
    if (n !== '') parts.push(`${n} ${label}`);
  };
  push(s['likes'], 'likes');
  push(s['reposts'], 'reposts');
  push(s['replies'], 'replies');
  push(s['quotes'], 'quotes');
  push(s['bookmarks'], 'bookmarks');
  push(s['views'], 'views');
  return parts.length > 0 ? `Stats: ${parts.join(' · ')}` : '';
};

const mediaLine = (s: Record<string, unknown>): string => {
  const m = s['media'];
  if (typeof m !== 'object' || m === null) return '';
  const r = m as Record<string, unknown>;
  const out: string[] = [];
  const photos = Array.isArray(r['photos']) ? r['photos'] : [];
  const videos = Array.isArray(r['videos']) ? r['videos'] : [];
  const gifs = Array.isArray(r['gifs']) ? r['gifs'] : [];
  for (const p of photos) {
    if (typeof p !== 'object' || p === null) continue;
    const url = esc((p as Record<string, unknown>)['url']);
    if (url) out.push(`![photo](${url})`);
  }
  const clip = (v: unknown, kind: string): void => {
    if (typeof v !== 'object' || v === null) return;
    const o = v as Record<string, unknown>;
    const variants = Array.isArray(o['variants']) ? o['variants'] : [];
    const first =
      variants.length > 0 && typeof variants[0] === 'object' && variants[0] !== null
        ? esc((variants[0] as Record<string, unknown>)['url'])
        : '';
    const url = first || esc(o['url']);
    const thumb = esc(o['thumbnail']);
    const dur = o['duration'];
    const durTxt = typeof dur === 'number' ? ` ${dur}s` : '';
    if (url)
      out.push(
        thumb
          ? `[${kind}${durTxt}](${url}) thumb: ![thumb](${thumb})`
          : `[${kind}${durTxt}](${url})`
      );
  };
  for (const v of videos) clip(v, 'video');
  for (const g of gifs) clip(g, 'gif');
  return out.length > 0 ? `Media: ${out.join(' | ')}` : '';
};

export const mdStatus = (s: Record<string, unknown>, heading = '# Post'): string => {
  const text = esc(s['raw_text']) || esc(s['text']);
  const by = authorTag(s['author']);
  const when = esc(s['created_at']);
  const url = esc(s['url']);
  const replyingTo = esc(s['replying_to']);
  const card = s['embed_card'];
  const cardTxt =
    typeof card === 'object' && card !== null
      ? esc((card as Record<string, unknown>)['title']) ||
        esc((card as Record<string, unknown>)['url']) ||
        'link card'
      : typeof card === 'string' && card !== 'tweet'
        ? card
        : '';
  const note = s['community_note'];
  const noteTxt =
    typeof note === 'object' && note !== null ? esc((note as Record<string, unknown>)['text']) : '';
  const out = [
    heading,
    '',
    line(by && `**${by}**`, when && `· ${when}`, url && `· [open](${url})`),
    '',
    ...text.split('\n').map(l => (l.trim() === '' ? '>' : `> ${l}`)),
    '',
    statsLine(s),
    mediaLine(s),
    replyingTo ? `Replying to: ${replyingTo}` : '',
    cardTxt ? `Link card: ${cardTxt}` : '',
    noteTxt ? `Community note: ${noteTxt}` : ''
  ];
  return out.filter(l => l !== '').join('\n');
};

export const mdUserBlock = (u: Record<string, unknown>): string => {
  const tag = authorTag(u);
  const desc = esc(u['description']);
  const facts: string[] = [];
  const f = (v: unknown, label: string) => {
    const n = num(v);
    if (n !== '') facts.push(`${n} ${label}`);
  };
  f(u['followers'], 'followers');
  f(u['following'], 'following');
  f(u['statuses'], 'posts');
  f(u['likes'], 'likes');
  f(u['media_count'], 'media');
  const meta: string[] = [];
  if (esc(u['location'])) meta.push(esc(u['location']));
  if (esc(u['website'])) meta.push(esc(u['website']));
  if (esc(u['joined'])) meta.push(`joined ${esc(u['joined'])}`);
  const ver = u['verification'];
  if (
    typeof ver === 'object' &&
    ver !== null &&
    esc((ver as Record<string, unknown>)['verified'])
  ) {
    meta.push(`verified(${(ver as Record<string, unknown>)['verified']})`);
  }
  if (u['protected'] === true) meta.push('protected');
  return [
    `**${tag}**${facts.length > 0 ? ` — ${facts.join(' · ')}` : ''}`,
    ...(desc ? desc.split('\n').map(l => `> ${l}`) : []),
    ...(meta.length > 0 ? [meta.join(' · ')] : []),
    esc(u['url']) ? `[open profile](${esc(u['url'])})` : ''
  ]
    .filter(l => l !== '')
    .join('\n');
};

const mdItem = (item: unknown, index: number): string => {
  if (isStatus(item)) {
    const s = item as Record<string, unknown>;
    const by = authorTag(s['author']);
    const id = esc(s['id']);
    const url = esc(s['url']);
    const text = (esc(s['raw_text']) || esc(s['text'])).split('\n')[0];
    const stats = statsLine(s);
    return `${index}. ${by ? `**${by}** — ` : ''}${text}${url ? ` ([open](${url}))` : id ? ` (id ${id})` : ''}${stats ? ` — ${stats.replace(/^Stats: /, '')}` : ''}`;
  }
  if (isUser(item))
    return `${index}. ${mdUserBlock(item as Record<string, unknown>).split('\n')[0]}`;
  if (typeof item === 'object' && item !== null) {
    // Trend / generic named item: prefer name/title + url.
    const o = item as Record<string, unknown>;
    const name = esc(o['name']) || esc(o['title']) || esc(o['label']);
    const url = esc(o['url']);
    const extra = esc(o['tweet_count']) || esc(o['count']) || esc(o['description']);
    if (name)
      return `${index}. ${name}${url ? ` ([open](${url}))` : ''}${extra ? ` — ${extra}` : ''}`;
    return `${index}. ${JSON.stringify(item).slice(0, 300)}`;
  }
  return `${index}. ${esc(item)}`;
};

export const mdList = (
  title: string,
  results: unknown[],
  cursorBottom: string | null,
  nextPath: string
): string => {
  const head = [`# ${title}`, '', `Count: ${results.length}`, ''];
  const body = results.map((r, i) => mdItem(r, i + 1));
  const tail = cursorBottom
    ? ['', `Next: \`${nextPath}${nextPath.includes('?') ? '&' : '?'}cursor=${cursorBottom}\``]
    : [];
  return [...head, ...body, ...tail].join('\n');
};

export const mdThreadDoc = (payload: Record<string, unknown>): string => {
  const status = payload['status'];
  const thread = payload['thread'];
  const author = payload['author'];
  let posts: unknown[] = [];
  if (Array.isArray(thread)) posts = thread;
  else if (typeof thread === 'object' && thread !== null) {
    const t = thread as Record<string, unknown>;
    if (Array.isArray(t['statuses'])) posts = t['statuses'] as unknown[];
    else if (Array.isArray(t['posts'])) posts = t['posts'] as unknown[];
  }
  if (posts.length === 0 && isStatus(status)) posts = [status];
  const head = isStatus(status)
    ? mdStatus(status as Record<string, unknown>, `# Thread (${posts.length} posts)`)
    : `# Thread (${posts.length} posts)`;
  const body: string[] = [head, ''];
  posts.forEach((p, i) => {
    if (i === 0) return; // main post already rendered above
    if (!isStatus(p)) return;
    body.push(`---\n\n## ${i + 1}/${posts.length}\n`);
    body.push(mdStatus(p as Record<string, unknown>, '').replace(/^# Post\n\n/, ''));
  });
  if (typeof author === 'object' && author !== null) {
    body.push('', '---', '', '## Author', mdUserBlock(author as Record<string, unknown>));
  }
  return body.join('\n');
};

export const mdConversationDoc = (payload: Record<string, unknown>): string => {
  const conv = payload['conversation'];
  let replies: unknown[] = [];
  if (Array.isArray(conv)) replies = conv;
  else if (typeof conv === 'object' && conv !== null) {
    const c = conv as Record<string, unknown>;
    if (Array.isArray(c['statuses'])) replies = c['statuses'] as unknown[];
    else if (Array.isArray(c['replies'])) replies = c['replies'] as unknown[];
  }
  const head = isStatus(payload['status'])
    ? mdStatus(payload['status'] as Record<string, unknown>, '# Post + replies')
    : '# Post + replies';
  const cursor = payload['cursor'];
  const bottom =
    typeof cursor === 'object' && cursor !== null
      ? esc((cursor as Record<string, unknown>)['bottom'])
      : null;
  return [
    head,
    '',
    `## Replies (${replies.length})`,
    '',
    ...replies.map((r, i) => mdItem(r, i + 1)),
    ...(bottom ? ['', `Next: \`?cursor=${bottom}\``] : [])
  ].join('\n');
};

export const mdProfileDoc = (payload: Record<string, unknown>): string => {
  const u = payload['user'] ?? payload['author'] ?? payload['profile'];
  if (typeof u !== 'object' || u === null) return mdError(payload);
  return `# Profile\n\n${mdUserBlock(u as Record<string, unknown>)}`;
};

export const mdSearchDoc = (
  payload: Record<string, unknown>,
  title: string,
  nextPath: string
): string => {
  const results = Array.isArray(payload['results']) ? (payload['results'] as unknown[]) : [];
  const cursor = payload['cursor'];
  const bottom =
    typeof cursor === 'object' && cursor !== null
      ? esc((cursor as Record<string, unknown>)['bottom'])
      : null;
  return mdList(title, results, bottom || null, nextPath);
};

export const mdError = (payload: Record<string, unknown>): string => {
  const code = payload['code'];
  const msg =
    esc(payload['message']) || esc(payload['error']) || 'Upstream returned no usable data.';
  return [
    '# Error',
    '',
    `Upstream code: ${typeof code === 'number' ? code : 'unknown'}`,
    '',
    `> ${msg}`,
    '',
    'Tips:',
    '- IDs must be exact (tweet id, `id:123` user id, Bluesky rkey).',
    '- Some routes need the worker credential pool (media, followers, trends on X).',
    '- TikTok allows only a few unsigned requests per IP before a cooldown.'
  ].join('\n');
};

export const isOk = (payload: unknown): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  (payload as Record<string, unknown>)['code'] === 200;
