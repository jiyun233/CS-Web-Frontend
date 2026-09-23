/**
 * Server-only Origin / Referer allowlist.
 *
 * Keep this module out of client components. ALLOWED_ORIGINS is a server
 * runtime setting and must not be evaluated in the browser bundle.
 */
import 'server-only';
import { networkInterfaces } from 'node:os';

const env = process.env.ALLOWED_ORIGINS;

const origins = env
  ? env.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['http://localhost:2333', 'http://localhost:3000'];

if (!env) {
  try {
    for (const addresses of Object.values(networkInterfaces())) {
      if (!addresses) continue;
      for (const address of addresses) {
        if (address.family === 'IPv4' && !address.internal) {
          origins.push(`http://${address.address}:2333`);
        }
      }
    }
  } catch {
    // Keep local development defaults if interface discovery fails.
  }
}

export const ALLOWED_ORIGINS = origins;
