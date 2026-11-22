# Super Mart POS: Improvement Plan

Date: 2026-10-30
Branch: `feat/exchanges-and-crud-hardening` (Electron 43, combined x64 + ia32 installer)
Status: **Phases 1-5 and 4f implemented (uncommitted). Left: 3b full cart-context split, 4e incremental refresh. See the end of this file.**

This plan covers five issues the client reported. For each one it gives:
1. **Verification**: what the code does now, with file and line references.
2. **Root cause**.
3. **Implementation**: the exact changes, file by file.
4. **Testing and acceptance criteria**.

The last sections cover the recommended order of work, database changes, and risks.

---

## Summary

| # | Issue | Verified? | Root cause (short) | Size | DB change |
|---|-------|-----------|--------------------|------|-----------|
| 5 | Logging out on the laptop also logged out the client PC | **Yes, confirmed** | `supabase.auth.signOut()` defaults to `scope: 'global'`, which revokes **every** session of that account on every PC | Small | No |
| 3 | Scanning takes 1 to 3 s to add an item | **Yes, confirmed** | Each scanner keystroke re-filters and re-renders the whole product grid (hundreds of blurred "glass" cards), and the whole app re-renders on every cart change | Medium | No |
| 1 | Search results don't show the full product name | **Yes, confirmed** | Names are cut to one line (`line-clamp-1` / `truncate`) in six places | Small | No |
| 2 | Opening balance for old customers | **Yes, the feature is missing** | Customers always start at balance 0. The only way to add a balance is through bills or payments | Small to medium | No (uses the existing ledger and trigger) |
| 4 | Cloud upload gets stuck, with no way to find out why | **Yes, confirmed** | No log file. Errors go only to `console` (not visible in the packaged app). Full error details are thrown away. Auth errors retry forever without telling anyone. Large uploads and full-database downloads time out | Large | Optional (`app_logs` table) |

Issues 4 and 5 are connected. After the laptop's global sign-out, the client PC's refresh token was revoked. Until the app noticed and signed out, its uploads failed with `JWT`/`401` errors. `isTransientSyncError` treats those as "retry forever", so the uploads looked **stuck** and nobody was told why.

---

## Issue 5: Logout on one PC logs out the other PCs

### Verification
- `src/contexts/AuthContext.tsx`, in `logout()`: `await supabase.auth.signOut();` has no `scope`.
- In `@supabase/auth-js` 2.101.0 (installed), `GoTrueClient.d.ts:1886` says: *"By default, `signOut()` uses the global scope, which signs out all other sessions that the user is logged into as well."*
- Both PCs were signed in with **the same account**. A global sign-out revokes all refresh tokens for that user. The client PC keeps working on its current access token until the next refresh (up to about 1 hour). Then the refresh fails, Supabase fires `SIGNED_OUT`, and `onAuthStateChange` (`AuthContext.tsx`) clears the user. The client sees this as being logged out "at random".

### Implementation
1. **`src/contexts/AuthContext.tsx`, `logout()`**
   - Change to `supabase.auth.signOut({ scope: 'local' })`. Only this PC's session ends, and the server revokes only this device's refresh token.
   - Keep the offline fallback that exists now (`stopAutoRefresh` + `clearStoredSupabaseSession`).
2. **Optional "Sign out everywhere" for admins**, in Settings → Users or Security.
   - A separate button calls `signOut({ scope: 'global' })` behind a confirm dialog that explains the effect: "This signs this account out on **all** PCs."
   - Useful if a PC is lost or a password leaked.
3. **Handle an unexpected server sign-out gracefully** (`onAuthStateChange`).
   - When `SIGNED_OUT` arrives without the user pressing Logout (for example a revoked token or a password change elsewhere), log it (see Issue 4) with the reason.
   - Show a clear toast: "You were signed out by the server (signed out on another PC or the password was changed). Sign in again. N unsaved changes are kept on this PC and will upload after you sign in."
   - The pending sync queue already lives in `localStorage` and is **not** cleared on sign-out. Verify this stays true and add a log line that records the count.
   - Track an `explicitLogoutRef` in `logout()` so this message isn't shown after a normal Logout.
4. **Operational recommendation (no code)**: give each person and each PC its own account: an admin for the owner, cashier accounts for staff, and a separate **developer** account for the laptop. User management through the `manage-users` Edge Function already supports this. With separate accounts, even a global sign-out can't affect the shop PC, and the logs and bill edit history show who did what.

### Testing and acceptance
- Sign in on PC A and PC B with the same account, then log out on A. B must stay signed in past at least two token refreshes. To test quickly, temporarily lower the JWT expiry in Supabase to 5 minutes, or call `supabase.auth.refreshSession()` from DevTools on B.
- An admin's "Sign out everywhere" logs out B within one refresh cycle and shows the explanatory message, not a silent kick.
- After a forced sign-out, B's pending changes are still queued and upload after B signs in again.

---

## Issue 3: Scanning is slow (1 to 3 s per item; target under 50 ms)

### Verification
A barcode scanner acts as a fast keyboard: it types about 13 characters and then Enter, within roughly 30 to 50 ms. In `src/pages/POSTerminal.tsx`:

| Where | What happens on **every** keystroke |
|---|---|
| `:510` `onChange={(e) => setSearchQuery(...)}` | POSTerminal re-renders |
| `:193-198` `filteredProducts = products.filter(...)` | Not memoized. Runs 3× `toLowerCase()` over **all** products on every render |
| `:564` `filteredProducts.map(...)` | Renders **every** matching product, with no limit. When the search is empty, or after 1 or 2 digits (almost every barcode contains "8"), that is close to the whole catalogue |
| `:575` each card uses `glass-card` | `src/index.css:376-378`: `backdrop-blur-lg` + `shadow-xl` on **every card**, plus gradient overlays and transitions. This is very expensive GPU compositing, and worst on the client's older 32-bit PC |
| `:505` header | `blur-xl` + `animate-pulse` layer behind the search box, which repaints constantly |

On Enter, `handleSearchKeyDown` (`:202-238`) does a linear `products.find(...)` twice (cheap), then `addToCart`.

`addToCart` (`StoreContext.tsx:2060`) calls `setCart`. **The whole `StoreProvider` (3,649 lines) re-renders**, and its `value={{...}}` (`:3559`) is a new object containing about 100 new function references. So **every** `useStore()` consumer re-renders: AppLayout, Sidebar, POSTerminal (the whole grid again), POSNumpad, CartDrawer, HeldCartsPanel. The effect at `:2133` also rebuilds a `Set` of all product ids on every cart change.

**Result:** about 14 full renders of a large blurred grid for each scan. At 70 to 200 ms each on a weak PC, that is the 1 to 3 s the client sees.

Secondary costs (not on the scan path itself, but they cause pauses during checkout and every few minutes):
- `src/db/db.ts:69-80` `saveArrayToDexie` does `table.clear()` + `bulkPut(all rows)`. It runs for **whole tables** (orders, orderItems, products, customers…) after every change, so every sale rewrites the entire sales history in IndexedDB.
- `StoreContext.tsx:1521-1532`: the whole pending queue is `JSON.stringify`'d into `localStorage` on every queue change.
- `StoreContext.tsx:1227-1268` `applyCloudSnapshot` compares tables with `JSON.stringify(a) !== JSON.stringify(b)` on the main thread, after downloading the **entire** database (`cloudSnapshot.ts:227`). This happens every 60 s when live updates are down, otherwise every 10 min. It can freeze the UI for a moment mid-scan.

### Implementation

#### 3a. Fast scan path (the main fix): `src/pages/POSTerminal.tsx`
1. **O(1) lookup maps**, built once whenever `products` changes:
   ```ts
   const productIndex = useMemo(() => {
     const byBarcode = new Map<string, Product>();   // enabled barcodes only
     const disabledBarcode = new Set<string>();
     const bySku = new Map<string, Product>();
     for (const p of products) {
       if (p.barcode) (p.barcodeEnabled ? byBarcode.set(p.barcode.toLowerCase(), p) : disabledBarcode.add(p.barcode.toLowerCase()));
       bySku.set(p.sku.toLowerCase(), p);
     }
     return { byBarcode, disabledBarcode, bySku };
   }, [products]);
   ```
   On Enter, use `byBarcode.get(q) ?? bySku.get(q)`. This keeps the current rules: a disabled barcode gives the same error, and stock and `allowNegativeStock` checks are unchanged.
2. **Keep scanner keystrokes from re-rendering the grid.** Make the search box **uncontrolled** (`ref` + `defaultValue`). Keep the grid filter in a separate state, updated through a **150 ms debounce** wrapped in `startTransition`. A scan (13 characters and Enter within about 50 ms) never triggers a single grid render. Enter reads `inputRef.current.value` directly, then clears the box and cancels the pending debounce. Typing by hand still filters live after 150 ms.
3. **Memoize and cap the grid.**
   - `filteredProducts = useMemo(...)` over a precomputed lowercase search key per product (`useMemo` over `products`).
   - Show at most **60** cards, with a "Showing 60 of 412 — type more to narrow down" line, the same pattern the Manage Bills list already uses.
   - With an empty search, show the first 60 products (or, later, "frequently sold").
4. **`ProductCard` as a `React.memo` component** (new file `src/components/pos/ProductCard.tsx`).
   - Takes `product`, `allowNegativeStock` and a stable `onPick` (`useCallback`).
   - Cards that didn't change are skipped on re-render.
5. **Cheaper card styling.**
   - Replace `glass-card` on grid cards with a solid `bg-card border shadow-sm`. **No `backdrop-blur`** on repeated elements.
   - Remove the hover gradient overlay `div` and the transform transitions.
   - Remove the `animate-pulse blur-xl` layer behind the search box.
   - The look stays close; the GPU cost drops sharply.
6. **One toast per scan, replaced in place.** Use `toast.success(..., { id: 'scan' })` so rapid scans update a single toast instead of stacking dozens.

#### 3b. Stop whole-app re-renders on cart changes: `src/contexts/StoreContext.tsx`
1. **Split the cart into its own context.**
   - New `src/contexts/CartContext.tsx` holds `cart`, `globalDiscount`, `heldCarts`, the cart functions and the totals (`calculateSubtotal`, `calculateTotal`, …).
   - `useStore()` keeps re-exporting them for compatibility, so pages don't all need to change at once.
   - Only cart consumers (CartDrawer, POSNumpad, the POS footer button, CheckoutModal, HeldCartsPanel) re-render on a scan. Sidebar, AppLayout and the product grid don't.
   - `checkout` needs cart data and store data, so it stays in StoreContext and reads the cart through a ref.
2. **Memoize the Store context value** with `useMemo`, and wrap the frequently used functions in `useCallback` (or use the "latest ref" pattern the file already uses, e.g. `productsRef`).
3. **Replace the effect at `:2133`.** Run the "remove deleted products from cart" check only when `products` changes, not on every cart change. Look up the existing `productIndex` instead of rebuilding a `Set`.

#### 3c. Remove periodic freezes (checkout and background refresh)
1. **Incremental IndexedDB saves** (`src/db/db.ts`).
   - Replace `clear()+bulkPut(all)` with a diff. Keep the last saved array per table in a module `WeakMap`/ref, then `bulkPut` only rows whose object reference changed and `bulkDelete` removed ids. State updates already create new objects only for changed rows, so a reference comparison is enough.
   - **Debounce** saves per table (300 ms) so a checkout that touches 5 tables writes once.
   - Keep a `flush()` on `beforeunload` / Electron `before-quit`.
2. **Move the sync queue from `localStorage` to IndexedDB.** The Dexie `syncQueue` table already exists in `db.ts:35-62` and is unused.
   - Write only the ops that changed, not the whole queue.
   - This also removes the 5 MB `localStorage` limit (see Issue 4).
   - Migrate once: read the old `pos_pending_sync_ops_v1`, write it to Dexie, delete the old key **only after the write succeeds**.
3. **Cheaper cloud-snapshot comparison.**
   - Compare row by row (id + a cheap `JSON.stringify` per row only when needed), and only for tables whose row count or max `created_at` changed.
   - Or move the comparison into `requestIdleCallback` chunks.
   - The longer-term fix is incremental refresh (Issue 4, 4e).

#### 3d. Measure it (so we can prove the fix)
- Add `performance.now()` timing around scan → cart updated → next paint (`requestAnimationFrame`).
- Log it through the new logger (Issue 4) under category `perf`, sampled (for example every 20th scan, and any scan over 100 ms).
- Settings → Diagnostics shows "average scan time (last 50)".

### Testing and acceptance
- Seed 3,000 products (a script under `scripts/`, run against local mode).
- Scanner simulation: an `esbuild` test script, or DevTools, that dispatches 13 key events at 3 ms intervals plus Enter.
- **Target: under 50 ms from Enter to the cart showing the item, on the client's 32-bit PC.** Check with the `perf` log and the React Profiler.
- Hand-typed search still filters, and clicking a card still adds it.
- `+`/`-`, F2, F9, F12 and Esc hotkeys behave exactly as before.
- Disabled barcode, out of stock and `allowNegativeStock` rules behave exactly as before.
- Checkout no longer pauses with 10k+ orders in history (measure checkout time before and after).

---

## Issue 1: Full product names in search results

### Verification
Names are cut off in these places:

| File:line | Current | Where it shows |
|---|---|---|
| `src/pages/POSTerminal.tsx:596` | `line-clamp-1` | **POS product grid / search results** (the reported one) |
| `src/components/pos/CartItemRow.tsx:54` | `truncate` | Cart drawer lines |
| `src/components/pos/POSNumpad.tsx:171` | `line-clamp-1` | "Last item" on the numpad |
| `src/pages/POSTerminal.tsx:890` | `truncate` | Edit Bill item lines |
| `src/components/pos/ExchangeDialog.tsx:273`, `:369` | `truncate` | Return/exchange item lists |

Printed receipts already word-wrap full names (`escposReceipt.ts:218`, `wrapText`). No change is needed there.

### Implementation
1. **POS grid card** (in the new `ProductCard` from 3a):
   - Show the **full name**, wrapped: `whitespace-normal break-words leading-snug`. No clamp.
   - Move the `Qty:` badge to its own line under the name, so a long name uses the whole card width.
   - Add `title={product.name}` for a hover tooltip.
   - Show the SKU and barcode under the name in small muted text. Two products with the same name can then still be told apart.
   - Let cards in a row stretch to the tallest card (grid default `items-stretch`), and put the price at the bottom with `mt-auto` so prices line up.
2. **Cart lines, numpad "last item", Edit Bill lines, and Exchange dialog**:
   - Replace `truncate` / `line-clamp-1` with `break-words` (a 2-line clamp is acceptable only where space is very tight, together with `title`).
   - In `CartItemRow`, make sure the quantity and price controls keep their width (`shrink-0`) so the name wraps instead of pushing them off screen.
3. **Search ranking (small extra)**: when filtering, sort matches so names **starting with** the query come first, then names containing it. "Surf Excel 500g" and "Surf Excel 1kg" then appear together at the top.
4. Optional, in the same pass: match **every word** of the query in any order ("excel 1kg" finds "Surf Excel 1kg"), using the precomputed search key from 3a.

### Testing and acceptance
- Create products with 60-character names that share the same first words. All of them are fully readable in the grid, the cart, the numpad, Edit Bill, and Exchange.
- Layout holds at 1024×640 (the window's minimum size) and at 1366×768, in both light and dark themes.

---

## Issue 2: Opening balance for existing customers (from the old ledger book)

### Verification
- `addCustomer` (`StoreContext.tsx:2759`) always creates a customer with `totalCredit: 0, totalPaid: 0, balance: 0`.
- `updateCustomer` (`:2776`) deliberately ignores totals: "Totals only ever change through ledger entries".
- The database trigger `pos_customer_tx_totals` (`MULTI_PC_SETUP.sql:81-115`) keeps totals in line with `customer_transactions`: `credit` adds to credit, `payment` adds to paid, and a "Credit reversal…" payment reduces credit.
- No "opening balance" feature exists. The only mention is a comment in `src/lib/reports.ts:471`.

### Design
Record the opening balance as a **normal ledger entry**, not as a number written directly onto the customer. This way:
- Totals stay correct on every PC through the existing trigger, so **no database change is needed**.
- The entry appears in the customer's ledger, statements and reports, dated on the day it was taken from the book.
- It can be edited or deleted like any manual entry if it was typed wrong.
- The aging report treats it as owed since that date.

Two directions:
- **Customer owes the shop** (the usual case): a `type: 'credit'` entry, description `Opening balance (from ledger book)`, no `orderId`.
- **Customer has an advance / the shop owes the customer**: a `type: 'payment'` entry with the same description. It adds to paid, so the balance becomes negative (in the customer's favour). `paymentMethod` stays `undefined` so it is **not** counted as cash taken today (see the reports check below).

### Implementation
1. **`src/lib/ledger.ts`**
   - Add `isOpeningBalance(t) => /^opening balance/i.test(t.description || '')`, following the same "description prefix" convention as `isCreditReversal`.
   - Add `OPENING_BALANCE_DESCRIPTION = 'Opening balance (from ledger book)'`.
2. **`src/contexts/StoreContext.tsx`**
   - New `addCustomerOpeningBalance(customerId, amount, direction: 'owes' | 'advance', asOfDate: string, note?: string): boolean`.
   - Validate with `isValidAmount`, `isValidLocalDate`, and no future date.
   - **Allow only one opening balance per customer.** If one already exists, show "This customer already has an opening balance. Edit it in the ledger instead."
   - `createdAt` = the chosen date at 00:00 local time (`withLocalDate`), so the entry sorts **before** all app entries.
   - Update local state with `applyCustomerLedger`, and queue `customer_credit` / `customer_payment` (both already handled in `executePendingSyncOperation`, `:779-780`).
   - Extend `addCustomer` to accept an optional `openingBalance: { amount, direction, asOfDate }`. It queues `customer_add` first and then the ledger entry. The queue runs in order, so the customer exists before the entry.
   - Make manual payment wording unable to fake one: if a hand-typed payment description starts with "Opening balance", reject it, the same way `REVERSAL_WORDING_ERROR` works.
3. **`src/pages/Customers.tsx`**
   - **Add Customer modal** (`:1031-1100`): new optional section "Previous balance (from old ledger book)" with:
     - an amount field,
     - a choice between "Customer owes us" (default) and "Advance / we owe customer",
     - an "As of date" field (default today, past dates allowed),
     - an optional note (e.g. "Book page 14").
   - **Customer details / ledger**: a "Set opening balance" button that shows only while the customer has none. It is for customers who were already added without one.
   - Show the entry in the ledger with an **"Opening balance"** badge.
   - Permissions: admin only, using the same rule as other ledger edits. Confirm against the current role checks in Customers.tsx.
4. **Reports check** (`src/lib/reports.ts`, `src/pages/Reports.tsx`)
   - Make sure the opening entry is **not** counted as a credit *sale* in sales and profit reports. It has no `orderId`. Verify every "credit sales" total is built from orders, not from ledger credit entries.
   - Make sure an "advance" opening entry is **not** counted as cash collected in the cash/day-close report. Filter with `isOpeningBalance`.
   - The aging report (`reports.ts:471`) can now date the balance using the entry's `createdAt`.
   - The customer statement shows it as the first line.
5. **Supplier opening balance (recommended, same pattern)**: old suppliers have the same problem. Add a `SupplierPurchase` with `amount > 0` (we owe) or `< 0` (advance paid), description `Opening balance (from ledger book)`, and `purchaseDate` = the as-of date. The supplier trigger already handles it. Add `isOpeningBalance` handling next to `isStockIntakeEntry` so it doesn't look like stock intake.

### Testing and acceptance
- New customer with an opening balance of 15,000 ("owes") → balance 15,000 on both PCs after sync, and the ledger shows one dated "Opening balance" line.
- A later credit sale of 2,000 → 17,000. A payment of 5,000 → 12,000.
- An "advance" of 3,000 → balance −3,000, and it is not in today's cash total.
- Editing the opening amount updates the balance on both PCs, and a second opening balance is refused.
- Daily sales and profit reports are unchanged by opening entries.
- Works offline: the entry is queued and uploads later.

---

## Issue 4: Cloud upload gets stuck: logging, diagnostics and robust sync

### Verification
- **No persistent logs.** Everything goes to `console.*` (for example `StoreContext.tsx:1304, 1411, 1474, 1477`, and `db.ts`). The packaged app has `Menu.setApplicationMenu(null)` (`electron/main.cjs:37`) and no DevTools, so **nobody can see these messages on the client PC**.
- **Error details are thrown away.** `errorText()` (`StoreContext.tsx:532`) keeps only `.message`. Supabase/PostgREST errors also have `code`, `details` and `hint` (for example `23503` foreign key, `42501` RLS, `PGRST…`), which is exactly what is needed to diagnose a rejection.
- **Auth failures retry forever, silently.** `isTransientSyncError` (`:539-544`) treats `jwt|401` as transient. With a revoked or expired session (see Issue 5), uploads retry for ever with no message.
- **Head-of-line blocking.** `processPendingSyncQueue` (`:1157-1172`) stops at the first failing op so the order is kept. That is correct for consistency, but one op that keeps timing out (for example a large `db_writes` batch hitting the 20 s `REQUEST_TIMEOUT_MS` in `src/lib/supabase.ts:12`) blocks every later op. A timeout counts as "transient", so this goes on forever.
- **Large batches are not chunked.** `runDbWrite` (`:510`) sends whole `rows` arrays in one request.
- **Full-database download.** `fetchCloudSnapshot` (`cloudSnapshot.ts:227-273`) downloads **every row of every table** (all orders and order_items, forever) in parallel. Each page has the same 20 s timeout. As the history grows this gets slower and fails more often, and it is skipped whenever anything is queued.
- **Queue in `localStorage`** (5 MB limit, `:1521-1532`). After a long offline period it fills up, and only a toast warns about it.
- **No React error boundary and no global error handlers.** A render crash leaves a white screen with no record of what happened.
- **No Electron main-process monitoring** (`render-process-gone`, `unresponsive`, `child-process-gone`), so a renderer hang or crash is invisible.
- Good existing pieces to build on: stock movements are idempotent (`apply_stock_movement` … `on conflict (id) do nothing`, `MULTI_PC_SETUP.sql:36-51`), and upserts are keyed by `id`, so retrying is safe.

### 4a. Logging system (foundation)

**Log files on disk (Electron)**
- Location: `%APPDATA%\modern-pos-system\logs\` (`app.getPath('userData')/logs`).
- Daily file `pos-YYYY-MM-DD.log`, **JSON lines** (one JSON object per line), so the files are easy to grep and to parse later.
- Keep **30 days**, maximum 10 MB per file (roll to `-2.log`), and delete older files on startup.

**New `electron/logger.cjs`** (no new npm dependency)
- `log(level, category, message, data)` appends to an in-memory buffer. The buffer is flushed with `fs.promises.appendFile` every 1 s, and also on `before-quit` and on error-level entries.
- Record format: `{ ts, level, cat, msg, data, app: version, arch: process.arch, pc: os.hostname(), user: <email or id when known>, session: <random id per app start> }`.
- Main-process hooks:
  - `process.on('uncaughtException' / 'unhandledRejection')`
  - `app.on('render-process-gone')` (reason, exitCode)
  - `webContents.on('unresponsive' / 'responsive')`, which logs **"UI frozen"** periods
  - `app.on('child-process-gone')`
  - the printer IPC errors in `printer.cjs`
- Startup line: app version, Electron version, Windows version, arch, free disk space, and the data path.

**IPC (`electron/preload.cjs`, `src/types/electron.d.ts`)**
- `posLog.write(entries[])`: batched from the renderer.
- `posLog.openFolder()`: `shell.openPath(logsDir)`.
- `posLog.exportBundle()`: zips the last 7 days of logs plus a `diagnostics.json` (queue contents with secrets redacted, sync status, settings without secrets, app/OS info) to the Desktop, so the client can WhatsApp or email it to us. For the zip, use Windows' built-in `tar.exe -a -c -f` (Windows 10 1803+), or a copy into a folder if `tar` is missing, to avoid adding a dependency.
- Only the main window may call these, using the same `isFromMainWindow` check as the printer IPC.

**New renderer logger: `src/lib/logger.ts`**
- `logger.debug/info/warn/error(category, message, data?)`.
- Categories: `sync`, `auth`, `db` (IndexedDB), `cloud` (refresh/realtime), `pos` (scan/checkout), `print`, `perf`, `ui`.
- Batches to `window.posLog.write` every 1 s. In the browser/dev build it falls back to a Dexie `logs` table (new Dexie version 3, capped at 5,000 rows).
- An in-memory ring buffer of the last 500 entries for the Diagnostics screen.
- **Redaction** of keys matching `password|token|access_token|refresh_token|apikey|authorization|service_role` and JWT-looking strings, applied before anything is written.
- **Error serializer**: keeps `name`, `message`, `code`, `details`, `hint`, `status`, and a short `stack`. Replace `errorText` uses in sync with this, and keep `errorText` only for UI text.
- Console mirror in dev only.

**Global error capture (`src/main.tsx`, `src/App.tsx`)**
- `window.addEventListener('error' / 'unhandledrejection')` → `logger.error('ui', ...)`.
- New `src/components/ErrorBoundary.tsx` around the routes. It shows a recovery screen ("Something went wrong — Reload. Your data and unsaved changes are kept on this PC.") with a **Reload** button and an **Export logs** button, and logs the error with the component stack.

### 4b. Instrument the sync and cloud code (what gets logged)

| Event | Level | Data |
|---|---|---|
| Op queued | debug | op id, type, payload size (bytes), queue length |
| Op upload start/end | info | op id, type, attempt, **duration ms**, rows count |
| Op failed | warn/error | op id, type, attempt, full serialized error (code/details/hint/status), classified as `network`/`timeout`/`auth`/`rls`/`fk`/`schema`/`other` |
| Op parked | error | op id, type, last error, payload summary (ids, table, row count; not full rows) |
| Queue blocked | warn | blocking op id/type, how long it has been blocked, next retry in |
| `checkServerReady` result | info | ready/needs-update/unreachable, schema version |
| Cloud refresh | info | duration, rows per table, skipped reason (queue busy, offline, unsafe) |
| Realtime channel status | info/warn | `SUBSCRIBED`/`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`, reconnect count |
| Auth events | info/warn | `SIGNED_IN`, `TOKEN_REFRESHED`, `SIGNED_OUT` (explicit vs server), refresh failures |
| Online/offline transitions | info | `navigator.onLine`, plus an actual reachability probe result |
| IndexedDB save failure | error | table, row count, error (today it is only `console.error` in `db.ts:78`) |
| Checkout | info | order id, item count, total, duration, local-save OK |
| Print | info/error | printer name, bytes, error |

### 4c. Sync robustness fixes (the actual "stuck" causes)
1. **Classify errors properly.** Replace the regex-only `isTransientSyncError` with `classifySyncError(err)` → `network | timeout | auth | rls | conflict | fk | schema | validation | unknown`, using `status`/`code` first and message text as a fallback.
   - `auth` (401, `JWT expired`, `invalid refresh token`): call `supabase.auth.refreshSession()` once. If that fails, **pause the queue** and show a persistent banner: "Sign in again to upload N waiting changes." Never retry silently forever.
   - `rls` (42501) / `schema` (42P01, 42703, PGRST204): park immediately with a clear message ("Database setup is out of date — run MULTI_PC_SETUP.sql"). Retrying won't help.
   - `fk` (23503): keep the existing special handling; log which column caused it.
   - `network`/`timeout`: retry with exponential backoff and jitter (2 s, 4 s, 8 s … capped at 60 s), as now, but **log every attempt**.
2. **Chunk large writes.** In `runDbWrite`, split `upsert` rows and `delete ... in (...)` id lists into chunks of 200. Each chunk is idempotent (upsert by id), so a timeout part-way through is safe to retry.
3. **Per-request timeout by type.** Keep 20 s for normal writes. Allow 45 s for chunked bulk writes and snapshot pages, so slow shop internet doesn't turn every large upload into an endless timeout loop.
4. **Watchdog for a hung run.** If one `processPendingSyncQueue` run takes longer than 2 minutes, log `error: sync run stuck` with the current op, then release `processingRef` so the next interval can retry. Today a never-settling promise would block all syncing until restart.
5. **Queue in IndexedDB** (same change as 3c.2). No 5 MB limit, and no data loss after a long offline period.
6. **Visible sync status.** The `syncStatus` object (`StoreContext.tsx:3546`) gains `blockedSince`, `blockedOp {type, error, attempts, nextRetryAt}` and `authPaused`. The sidebar sync indicator shows "Upload waiting on: Sale #A1B2C3 — No internet (retry in 30 s)" instead of a bare count.

### 4d. Diagnostics screen (Settings → new "Diagnostics" tab, admin only)
- **Sync status**: online/live, pending/parked counts, last successful sync, oldest waiting change and its age.
- **Waiting changes table**: type, created at, attempts, last error (full code/details/hint). Actions:
  - **Retry now** (exists as `manualSync`; also retries parked ops).
  - **Export this change** (JSON) and **Discard** (admin, double-confirm, and the discarded op is written to the log in full first, so nothing is lost without a trace). Use this only for a change the database will never accept.
- **Recent log**: the last 500 entries from the ring buffer, filterable by level and category.
- **Buttons**: Open logs folder · Export diagnostics bundle · Copy summary.
- **Performance**: average and worst scan time (from 3d), last cloud refresh duration.

### 4e. Optional, later: incremental cloud refresh (needs a DB change)
- Add `updated_at timestamptz default now()` plus a `before update` trigger on each synced table. Add a `deleted_rows(table, id, deleted_at)` tombstone table filled by `after delete` triggers.
- The refresh then fetches only rows with `updated_at > lastRefreshAt` (and new tombstones) instead of the whole database. This makes the safety-net refresh fast and reliable no matter how large the history grows.
- This is a `MULTI_PC_SETUP.sql` v4 migration (schema version 4). It is optional and can be done after 4a–4d have shown where the real problems are.

### 4f. Optional: central error reporting (needs a DB change)
- A `public.app_logs` table (insert-only for authenticated users through RLS, no select for cashiers) that receives **warn and error** entries only. Throttled (at most 50 per hour per PC) and uploaded through the same queue.
- This lets us see the client's sync errors from the Supabase dashboard without visiting the shop. It must never contain payloads, only error metadata.

### Testing and acceptance
- Unplug the network mid-checkout → the log shows the network failure, the retries with backoff, and the successful upload on reconnect, with timings.
- Revoke the session (Issue 5 scenario) → the banner "Sign in again to upload N changes" appears, the log has the `auth` class, and there is no silent loop.
- Rename a column in a test project → the op is parked with the code `42703` and the message is shown in Diagnostics.
- 2,000-row backlog → uploads in chunks with no endless timeout.
- Kill the renderer (`process.crash()` in dev) → `render-process-gone` is logged. Throw inside a component → the ErrorBoundary screen appears and the error is logged.
- Export bundle → a zip on the Desktop with logs and `diagnostics.json`, and **no passwords or tokens** in it (grep the output for `eyJ`, `password`, `refresh`).
- The log folder stays at 30 days or less and under about 300 MB worst case.

---

## Recommended order of work

| Phase | Items | Why first |
|---|---|---|
| **1. Quick fixes** | Issue 5 (local sign-out + server sign-out message); Issue 1 (full names) | Small, low risk, the client feels them right away |
| **2. Logging foundation** | 4a (logger, Electron log files, error boundary, global handlers) | Every later fix can then be measured and diagnosed on the client PC |
| **3. Scan speed** | 3a (fast scan path, grid cap, cheap cards) → 3d (measure) → 3b (cart context split) | 3a alone should remove most of the delay; 3b finishes the job |
| **4. Sync robustness** | 4b instrumentation → 4c fixes → 4d Diagnostics tab → 3c (incremental Dexie saves, queue to IndexedDB) | Uses the logging from phase 2 |
| **5. Opening balance** | Issue 2 (customers, then suppliers) | Independent feature; no DB change |
| **6. Optional** | 4e incremental refresh (DB v4), 4f central error log | After real-world logs show whether they are needed |

Each phase is its own commit (or PR), typechecked with `npx tsc --noEmit -p tsconfig.app.json --ignoreDeprecations 5.0`. Logic (ledger, error classification, chunking, Dexie diff) is tested with small `esbuild` scripts under `scripts/`, because the project has no test runner. Each phase also gets a manual run in `npm run electron:dev`, plus a 32-bit installer build (`npm run dist`) tested on the client's PC before release.

## Database changes

| Change | Needed for | Required? |
|---|---|---|
| None | Issues 1, 2, 3, 5, and 4a–4d | — |
| `updated_at` columns + triggers + tombstone table (DB v4) | 4e incremental refresh | Optional |
| `app_logs` table + RLS | 4f central error reporting | Optional |

If 4e or 4f is done, `REQUIRED_SCHEMA_VERSION` changes, and the client must re-run the updated `MULTI_PC_SETUP.sql` before installing the new app version (same procedure as v3).

## Risks and notes
- **Cart context split (3b)** touches the most code. Keep the `useStore()` API unchanged by re-exporting the cart fields, so pages keep working. Do it after 3a has been measured: if 3a already reaches under 50 ms, 3b can be smaller (only memoizing the context value).
- **Moving the sync queue to IndexedDB** must never drop the existing `localStorage` queue. Migrate, verify the count, and only then delete the old key. Log the migration.
- **Opening balances** follow the "description prefix" convention already used for credit reversals. The wording is reserved (manual payments can't use it) so the rule can't be faked by accident.
- **Logs** must never contain passwords, tokens, or the Supabase keys. Redaction is tested as part of acceptance.
- **Electron stays on 43.x** (32-bit Windows support). Nothing in this plan needs a newer Electron or a new native dependency.

---

## Implementation status (2026-11-23)

| Item | State |
|---|---|
| Issue 5 (local sign-out, "Sign out everywhere", server sign-out message) | Done |
| Issue 1 (full names: grid, cart, numpad, Edit Bill, Exchange) | Done |
| 4a logging (Electron log files, renderer logger, ErrorBoundary, global handlers, export bundle) | Done |
| 3a fast scan path (lookup maps, uncontrolled search box, 60-tile cap, memo cards) | Done |
| 3b cart context split | **Not done**: only the product-id Set is memoized. Measure 3a on the client PC first |
| 3c incremental IndexedDB saves, queue moved to IndexedDB | Done |
| 3d scan timing (perf log, Diagnostics averages) | Done |
| 4b/4c sync instrumentation and fixes (classification, backoff, auth pause, chunking, timeouts, watchdog, status) | Done |
| 4d Diagnostics section in Settings (admin) | Done (a card on the Settings page, not a separate tab) |
| Issue 2 opening balance (customers and suppliers, reports checked) | Done |
| 4f central error log (`app_logs`, optional) | Done, no schema version change |
| 4e incremental cloud refresh (DB v4) | **Not done**, as the plan gates it on real logs |

Tests: `npm run test:logic`.
