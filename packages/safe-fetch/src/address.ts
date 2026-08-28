/**
 * IP address classification for outbound request safety.
 *
 * This module is the single place ORAtlas decides whether a network
 * destination is a public internet address. Every outbound fetch that can be
 * pointed at an attacker-chosen host — DOI resolution, publication
 * registration — classifies through here, so there is one rule rather than
 * several that drift apart.
 *
 * The classification is deliberately coarse and fail-closed: anything not
 * positively recognised as globally routable unicast is rejected.
 */

/**
 * What kind of destination an address is. Only `public` is reachable under the
 * default policy.
 */
export const ADDRESS_CLASSES = [
  "public",
  "loopback",
  "private",
  "link-local",
  "cloud-metadata",
  "unspecified",
  "multicast",
  "reserved",
] as const;
export type AddressClass = (typeof ADDRESS_CLASSES)[number];

/**
 * Well-known cloud instance-metadata addresses. They fall inside broader
 * blocked ranges already; they are named separately so a rejection says which
 * risk was actually hit, which matters in an audit trail.
 */
const METADATA_ADDRESSES = new Set([
  // AWS, GCP, Azure, DigitalOcean, Oracle: IMDS.
  "169.254.169.254",
  // Alibaba Cloud.
  "100.100.100.200",
  // AWS IMDS over IPv6.
  "fd00:ec2::254",
]);

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Parse a dotted-quad IPv4 literal into its four octets, or `null`. */
export function parseIpv4(value: string): [number, number, number, number] | null {
  const match = IPV4_RE.exec(value);
  if (match === null) return null;
  const octets = match.slice(1).map((part) => {
    // Reject "01" style octets: they are parsed as octal by some resolvers and
    // as decimal by others, which is exactly the ambiguity an attacker wants.
    if (part.length > 1 && part.startsWith("0")) return Number.NaN;
    return Number(part);
  });
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets as [number, number, number, number];
}

function classifyIpv4(octets: [number, number, number, number]): AddressClass {
  const [a, b, c] = octets;
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  // RFC 6598 carrier-grade NAT: not the public internet, and Alibaba's IMDS
  // lives inside it.
  if (a === 100 && b >= 64 && b <= 127) return "private";
  if (a === 169 && b === 254) return "link-local";
  // RFC 6890 special-purpose blocks that are neither public nor routable.
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return "reserved";
  if (a === 192 && b === 88 && c === 99) return "reserved";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if (a === 198 && b === 51 && c === 100) return "reserved";
  if (a === 203 && b === 0 && c === 113) return "reserved";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  return "public";
}

/** Expand an IPv6 literal to its eight 16-bit groups, or `null` if malformed. */
function parseIpv6Groups(value: string): number[] | null {
  let text = value;
  // An embedded IPv4 suffix ("::ffff:10.0.0.1") is rewritten to hex groups so
  // a mapped private address cannot slip past the IPv6 rules.
  const embedded = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (embedded !== null) {
    const octets = parseIpv4(embedded[1]!);
    if (octets === null) return null;
    const [a, b, c, d] = octets;
    text = `${text.slice(0, embedded.index + 1)}${((a << 8) | b).toString(16)}:${(
      (c << 8) |
      d
    ).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };
  const head = parseGroups(halves[0]!);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parseGroups(halves[1]!);
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function classifyIpv6(groups: number[]): AddressClass {
  const first = groups[0]!;
  if (groups.every((group) => group === 0)) return "unspecified";
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return "loopback";
  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible addresses are classified by
  // their embedded IPv4 value, never treated as public because they are IPv6.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const a = groups[6]! >> 8;
    const b = groups[6]! & 0xff;
    const c = groups[7]! >> 8;
    const d = groups[7]! & 0xff;
    return classifyIpv4([a, b, c, d]);
  }
  if ((first & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return "link-local"; // fe80::/10
  if ((first & 0xff00) === 0xff00) return "multicast"; // ff00::/8
  if (first === 0x2001 && (groups[1]! & 0xff00) === 0x0000) return "reserved"; // 2001::/23 IETF
  if (first === 0x2001 && groups[1] === 0x0db8) return "reserved"; // documentation
  if (first === 0x0064 && groups[1] === 0xff9b) return "reserved"; // NAT64
  return "public";
}

/**
 * Classify an IP literal. Returns `null` when the value is not an IP address
 * at all (a DNS name, for instance), which callers must treat as "resolve it
 * first, then classify every resolved address".
 */
export function classifyIpAddress(value: string): AddressClass | null {
  const trimmed = value.replace(/^\[|\]$/g, "").trim();
  if (trimmed.length === 0) return null;
  if (METADATA_ADDRESSES.has(trimmed.toLowerCase())) return "cloud-metadata";

  const ipv4 = parseIpv4(trimmed);
  if (ipv4 !== null) return classifyIpv4(ipv4);

  // A zone index ("fe80::1%eth0") never denotes a public address.
  const [literal] = trimmed.toLowerCase().split("%");
  if (!literal!.includes(":")) return null;
  const groups = parseIpv6Groups(literal!);
  if (groups === null) return null;
  const classified = classifyIpv6(groups);
  if (classified === "public" && trimmed.includes("%")) return "link-local";
  return classified;
}

/** True when the value is syntactically an IP literal of either family. */
export function isIpLiteral(value: string): boolean {
  return classifyIpAddress(value) !== null;
}

/** Human-readable reason for a rejected address class. Never leaks the address. */
export function describeAddressClass(addressClass: AddressClass): string {
  switch (addressClass) {
    case "public":
      return "a public internet address";
    case "loopback":
      return "a loopback address";
    case "private":
      return "a private-network address";
    case "link-local":
      return "a link-local address";
    case "cloud-metadata":
      return "a cloud instance-metadata address";
    case "unspecified":
      return "an unspecified address";
    case "multicast":
      return "a multicast address";
    case "reserved":
      return "a reserved address";
  }
}
