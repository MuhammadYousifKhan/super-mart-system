import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Database features will not work.');
}

// With Wi-Fi connected but no internet, a request can hang for minutes. Give up after this long so
// the change is queued on this device and retried instead of leaving the cashier waiting.
const REQUEST_TIMEOUT_MS = 20000;
// Slow shop internet: data reads (snapshot pages) and large uploads get longer before they count
// as timed out, otherwise a big backlog would time out again and again and never finish.
const BULK_REQUEST_TIMEOUT_MS = 45000;
const BULK_BODY_BYTES = 50 * 1024;

const timeoutFor = (url: string, isWrite: boolean, init: RequestInit): number => {
  if (!url.includes('/rest/v1/')) return REQUEST_TIMEOUT_MS; // login and token refresh stay quick
  if (!isWrite) return BULK_REQUEST_TIMEOUT_MS;
  const size = typeof init.body === 'string' ? init.body.length : 0;
  return size > BULK_BODY_BYTES ? BULK_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
};

let writesInFlight = 0;
let lastWriteStartedAt = 0;

const fetchWithTimeout = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const isWrite = method !== 'GET' && method !== 'HEAD';

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const timeoutMs = timeoutFor(url, isWrite, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  }

  if (isWrite) {
    writesInFlight += 1;
    lastWriteStartedAt = Date.now();
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (isWrite) writesInFlight -= 1;
  });
};

/**
 * Lets the background refresh tell whether a cloud write is in progress or started recently,
 * so it never replaces local data with a server copy that is missing that write.
 */
export function getCloudWriteActivity() {
  return { writesInFlight, lastWriteStartedAt };
}

// Create a client with dummy values if missing to prevent crash on initialization
// The actual API calls will fail or be skipped based on checks in StoreContext
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      // localStorage keeps the user signed in across app restarts until they sign out.
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    },
    global: {
      fetch: fetchWithTimeout,
    },
  }
);
