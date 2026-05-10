import pLimit, { type LimitFunction } from 'p-limit';
import { config } from '../config.js';

export const globalLimit = pLimit(config.GLOBAL_CONCURRENCY);

const domainLimits = new Map<string, LimitFunction>();

export function perDomainLimit(url: string): LimitFunction {
  const host = new URL(url).hostname;
  let limit = domainLimits.get(host);
  if (!limit) {
    limit = pLimit(config.DOMAIN_CONCURRENCY);
    domainLimits.set(host, limit);
  }
  return limit;
}
