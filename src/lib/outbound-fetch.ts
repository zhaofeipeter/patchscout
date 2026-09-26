import {
  ProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";

let cachedProxyUrl: string | undefined;
let cachedDispatcher: Dispatcher | undefined;

function proxyDispatcher(): Dispatcher | undefined {
  const proxyUrl =
    process.env.OUTBOUND_PROXY_URL?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim();

  if (!proxyUrl) return undefined;

  if (!cachedDispatcher || cachedProxyUrl !== proxyUrl) {
    cachedDispatcher = new ProxyAgent(proxyUrl);
    cachedProxyUrl = proxyUrl;
  }

  return cachedDispatcher;
}

export async function outboundFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const dispatcher = proxyDispatcher();
  if (!dispatcher) {
    return fetch(input, init);
  }

  const {
    cache: _cache,
    ...undiciInit
  } = (init || {}) as RequestInit & { cache?: RequestCache };
  void _cache;

  return (await undiciFetch(input, {
    ...(undiciInit as Parameters<typeof undiciFetch>[1]),
    dispatcher,
  })) as unknown as Response;
}
