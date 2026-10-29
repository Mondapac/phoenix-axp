import { isIPv6 } from 'node:net';

// The client network a rate limit counts (moved from the forms module in slice 1.8, for the
// portal sign-in's limits too).

/**
 * The network an address counts under: an IPv6 address by its /64 (one host usually holds a
 * whole /64, so counting single addresses would give it endless buckets; security review L7),
 * an IPv4 address (also when mapped into IPv6) as it is.
 */
export function addressNetwork(address: string): string {
  if (!isIPv6(address)) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped !== null) return mapped[1]!;
  const [head = '', tail = ''] = address.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  // A trailing dotted IPv4 part (`64:ff9b::1.2.3.4`) takes two groups.
  const width = (parts: string[]): number =>
    parts.length + (parts.at(-1)?.includes('.') === true ? 1 : 0);
  const groups = address.includes('::')
    ? [...left, ...Array<string>(8 - width(left) - width(right)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(':')}::/64`;
}
