import { BadRequestException } from '@nestjs/common';
import dns from 'dns/promises';
import net from 'net';

/** Block cloud metadata + private/link-local/reserved ranges (IPv4 + common v6). */
function isPrivateAddress(address: string): boolean {
  if (address.includes('.')) {
    const parts = address.split('.').map(Number);
    if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
    const n =
      ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    return (
      (n & 0xff000000) === 0x00000000 || // 0.0.0.0/8
      (n & 0xff000000) === 0x0a000000 || // 10/8
      (n & 0xff000000) === 0x7f000000 || // 127/8 (loopback)
      (n & 0xffff0000) === 0xa9fe0000 || // 169.254/16 (cloud metadata)
      (n & 0xfff00000) === 0xac100000 || // 172.16/12
      (n & 0xffffff00) === 0xc0000200 || // 192.0.2/24 (TEST-NET)
      (n & 0xffff0000) === 0xc0a80000 || // 192.168/16
      (n & 0xff000000) === 0xe0000000 || // 224/4 (multicast)
      (n & 0xff000000) === 0xff000000 // 255.255.255.255
    );
  }
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  if (lower.startsWith('fe80')) return true; // link-local
  return false;
}

/**
 * Reject webhook URLs that resolve (or could resolve) to internal hosts —
 * prevents SSRF against cloud metadata, localhost, and private networks.
 */
export async function assertSafeWebhookUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Webhook URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('Webhook URL must use http or https');
  }

  const hostname = url.hostname;
  if (net.isIP(hostname) > 0) {
    if (isPrivateAddress(hostname)) {
      throw new BadRequestException(
        'Webhook URL points to a private or reserved address',
      );
    }
    return;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new BadRequestException('Webhook hostname does not resolve');
  }
  if (records.length === 0) {
    throw new BadRequestException('Webhook hostname does not resolve');
  }
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new BadRequestException(
        'Webhook URL resolves to a private or reserved address',
      );
    }
  }
}
