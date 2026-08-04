// src/lib/net/public-fetch.ts
//
// A `fetch` for URLs that originate — however indirectly — from user input.
// Server-only (imports node:dns).
//
// A host-name allowlist is not enough on its own: the name is resolved by the
// kernel at connect time, so a name that looks public can answer with
// 127.0.0.1 or 169.254.169.254, and a 302 can move an allowed request onto a
// disallowed target after the check has passed. So this module checks the
// resolved ADDRESSES, not the name, and re-checks on every redirect hop.
//
// What it deliberately does NOT claim: this is not a hermetic DNS-rebinding
// defence. Between our `lookup` and the socket's own resolution the record can
// change (the classic TOCTOU), which only pinning the connection to a verified
// IP would close. That needs a custom agent per request; the address check plus
// manual redirect handling covers the practical cases (metadata endpoints,
// loopback, RFC1918, redirect chains) at a fraction of the complexity.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedTargetError";
  }
}

/** Max redirects followed. Each hop is re-validated before it is taken. */
const MAX_REDIRECTS = 3;

function ipv4IsPrivate(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable — refuse rather than guess
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (incl. 100.100.100.200)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Expands an IPv6 address to its 8 numeric groups, or null if it doesn't
 * parse. Both notations have to be handled: a literal may arrive dotted
 * (`::ffff:127.0.0.1`) from a DNS answer, while WHATWG `URL` normalizes the
 * same address to hex (`::ffff:7f00:1`) — matching only one of the two leaves
 * a loopback bypass.
 */
function ipv6Groups(addr: string): number[] | null {
  let a = addr;
  const dotted = a.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const octets = dotted[2]!.split(".").map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    a = `${dotted[1]}${hi}:${lo}`;
  }

  const halves = a.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":").map((g) => parseInt(g, 16)));

  let groups: number[];
  if (halves.length === 2) {
    const head = parse(halves[0]!);
    const tail = parse(halves[1]!);
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
  } else {
    groups = parse(halves[0]!);
  }
  if (groups.length !== 8) return null;
  if (groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

function ipv6IsPrivate(addr: string): boolean {
  const g = ipv6Groups(addr.toLowerCase().split("%")[0]!); // strip zone id
  if (!g) return true; // unparseable — refuse rather than guess

  // ::1 (loopback) and :: (unspecified).
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) return true;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) — judge the
  // embedded v4 address, which is where 127.0.0.1 and 169.254.169.254 hide.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
    return ipv4IsPrivate(v4);
  }

  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

function addressIsPrivate(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) return ipv4IsPrivate(addr);
  if (family === 6) return ipv6IsPrivate(addr);
  return true; // not an IP we understand — refuse
}

/**
 * Throws unless `url` is an https URL whose host resolves exclusively to
 * public addresses. `http:` is refused outright: every caller today fetches
 * assets we ourselves uploaded over TLS, so plaintext only widens the target
 * surface.
 */
export async function assertPublicHttpsTarget(url: URL): Promise<void> {
  if (url.protocol !== "https:") {
    throw new BlockedTargetError(`refusing non-https target (${url.protocol})`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // An IP literal never reaches DNS — judge it directly.
  if (isIP(host)) {
    if (addressIsPrivate(host)) {
      throw new BlockedTargetError(`refusing non-public address ${host}`);
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new BlockedTargetError(`could not resolve ${host}`);
  }
  if (addresses.length === 0) {
    throw new BlockedTargetError(`${host} resolved to nothing`);
  }
  // ALL addresses must be public. A host that answers with one public and one
  // loopback address is still a usable SSRF primitive — the socket picks.
  for (const { address } of addresses) {
    if (addressIsPrivate(address)) {
      throw new BlockedTargetError(`${host} resolves to non-public address ${address}`);
    }
  }
}

/**
 * `fetch`, restricted to public https targets, with redirects followed
 * manually so each hop is validated before it is taken.
 *
 * Throws BlockedTargetError for a disallowed target (including a disallowed
 * redirect); other failures propagate as normal fetch errors.
 */
export async function fetchPublicUrl(
  rawUrl: string,
  init?: Omit<RequestInit, "redirect">,
): Promise<Response> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new BlockedTargetError("target is not a valid URL");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpsTarget(target);
    const res = await fetch(target, { ...init, redirect: "manual" });
    // Anything that isn't a 3xx is the answer. Written as a positive test so a
    // response without a numeric status can't be mistaken for a redirect.
    const isRedirect = typeof res.status === "number" && res.status >= 300 && res.status <= 399;
    if (!isRedirect) return res;

    const location = res.headers.get("location");
    if (!location) return res; // a 3xx with no Location is just a response
    try {
      target = new URL(location, target);
    } catch {
      throw new BlockedTargetError("redirect Location is not a valid URL");
    }
  }
  throw new BlockedTargetError(`exceeded ${MAX_REDIRECTS} redirects`);
}
