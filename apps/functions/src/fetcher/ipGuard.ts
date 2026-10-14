import { BlockList, isIP } from "node:net";

const blocked = new BlockList();

const V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // inkl. Cloud-Metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, "ipv4");

const V6: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local (inkl. fd00:ec2::254)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8],
];
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, "ipv6");

/** Wandelt IPv4-mapped/-compatible IPv6 (::ffff:a.b.c.d bzw. ::ffff:7f00:1) in IPv4 um. */
function unmapIpv4(ip: string): string | null {
  const m = /^(?:0{0,4}:){0,5}(?:ffff:)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return m[1] as string;
  const hex = /^(?:0{0,4}:){0,5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const hi = parseInt(hex[1] as string, 16);
    const lo = parseInt(hex[2] as string, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** true, wenn die Adresse nicht öffentlich routbar ist ODER nicht sicher klassifizierbar ist. */
export function isBlockedIp(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const family = isIP(ip);
  if (family === 0) return true; // fail closed
  if (family === 4) return blocked.check(ip, "ipv4");
  const mapped = unmapIpv4(ip);
  if (mapped) return blocked.check(mapped, "ipv4");
  return blocked.check(ip, "ipv6");
}
