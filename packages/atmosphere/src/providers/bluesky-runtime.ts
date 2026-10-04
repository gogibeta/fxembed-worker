import type { BlueskyProxyCredentials } from '../types/proxy-credentials.js';

/**
 * Configurable Bluesky web/API roots and feature domain lists.
 * The FxEmbed worker calls {@link setBlueskyProviderEnv} at startup (see `worker.ts`).
 */
export type BlueskyProviderEnv = {
  apiRoot: string;
  /**
   * Backup AppView used when the primary one answers 403 / transient errors. `public.api.bsky.app`
   * sits behind BunnyCDN, whose bot rules answer `app.bsky.feed.searchPosts` with an HTML 403 page
   * from datacenter IPs while every other method passes; `api.bsky.app` is the same AppView served
   * by Bluesky's own origin, so search (and anything else the edge blocks) retries there.
   */
  alternateApiRoot: string;
  webRoot: string;
  videoBase: string;
  mosaicBskyDomainList: string[];
  polyglotDomainList: string[];
};

const defaultEnv: BlueskyProviderEnv = {
  apiRoot: 'https://public.api.bsky.app',
  alternateApiRoot: 'https://api.bsky.app',
  webRoot: 'https://bsky.app',
  videoBase: 'https://video.bsky.app',
  mosaicBskyDomainList: [],
  polyglotDomainList: []
};

let env: BlueskyProviderEnv = { ...defaultEnv };

export function setBlueskyProviderEnv(partial: Partial<BlueskyProviderEnv>): void {
  env = { ...env, ...partial };
}

export function getBlueskyProviderEnv(): BlueskyProviderEnv {
  return env;
}

/**
 * PDS proxy account access (decrypt + session) lives in the worker; this interface is registered at startup.
 */
export type BlueskyProxyRuntime = {
  initCredentials: (key: string | undefined) => Promise<void>;
  hasBundledEncryptedCredentials: () => boolean;
  hasBlueskyProxyAccounts: () => boolean;
  getShuffledBlueskyAccounts: (preferredHostname?: string) => BlueskyProxyCredentials[];
  blueskyProxyServiceHostname: (service: string) => string;
};

let proxy: BlueskyProxyRuntime | null = null;

/** No-op fallback so clients can call public AppView XRPC without worker proxy wiring. */
const noopProxy: BlueskyProxyRuntime = {
  initCredentials: async () => {},
  hasBundledEncryptedCredentials: () => false,
  hasBlueskyProxyAccounts: () => false,
  getShuffledBlueskyAccounts: () => [],
  blueskyProxyServiceHostname: () => ''
};

export function setBlueskyProxyRuntime(r: BlueskyProxyRuntime): void {
  proxy = r;
}

export function getBlueskyProxyRuntime(): BlueskyProxyRuntime {
  return proxy ?? noopProxy;
}
