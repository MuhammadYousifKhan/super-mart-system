// Small in-memory performance figures shown in Settings > Diagnostics, and sampled into the log.
import { logger } from '@/lib/logger';

const SCAN_WINDOW = 50;
const scanTimes: number[] = [];
let scanCount = 0;
let lastCloudRefreshMs: number | null = null;

/** Time from pressing Enter on a scan to the cart showing the item (after the next paint). */
export function recordScanTime(ms: number) {
  scanTimes.push(ms);
  if (scanTimes.length > SCAN_WINDOW) scanTimes.shift();
  scanCount += 1;
  // Logged for every 20th scan and for any slow one, to keep the log small.
  if (ms > 100 || scanCount % 20 === 0) {
    logger.info('perf', 'Scan to cart', { ms: Math.round(ms), scans: scanCount });
  }
}

export function getScanStats() {
  if (scanTimes.length === 0) return { count: 0, averageMs: null as number | null, worstMs: null as number | null };
  const total = scanTimes.reduce((sum, t) => sum + t, 0);
  return { count: scanTimes.length, averageMs: total / scanTimes.length, worstMs: Math.max(...scanTimes) };
}

export function recordCloudRefresh(ms: number) {
  lastCloudRefreshMs = ms;
}

export const getLastCloudRefreshMs = () => lastCloudRefreshMs;
