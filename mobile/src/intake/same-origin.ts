// Pure same-origin check for the intake WebView's navigation lock. String-only
// (no `new URL()`) so behavior is identical under Node (tests) and Hermes (runtime) —
// React Native's URL implementation is incomplete. `base` is an origin with no
// trailing path (e.g. "https://app.foundryplanning.com"). Returns true only for that
// exact origin or a path/query/hash under it, closing the `base + ".evil.com"`
// (domain-suffix) and `base + "@evil.com"` (userinfo) bypasses a bare startsWith allows.
export function isSameOriginUrl(url: string, base: string): boolean {
  return (
    url === base ||
    url.startsWith(`${base}/`) ||
    url.startsWith(`${base}?`) ||
    url.startsWith(`${base}#`)
  );
}
