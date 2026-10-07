import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Database features will not work.');
}

// With Wi-Fi connected but no internet, a request can hang for minutes. Give up after this long so
// the change is queued on this device and retried instead of leaving the cashier waiting.
const REQUEST_TIMEOUT_MS = 20000;

let writesInFlight = 0;
let lastWriteStartedAt = 0;

const fetchWithTimeout = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const isWrite = method !== 'GET' && method !== 'HEAD';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), REQUEST_TIMEOUT_MS);
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
