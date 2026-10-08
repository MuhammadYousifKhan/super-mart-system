-- Multi-PC support: run once in the Supabase SQL Editor, AFTER the new app version is installed
-- on every PC. Safe to run again. Existing stock and balances are left exactly as they are.
--
-- With two PCs selling at the same time (or offline), saving absolute figures ("stock = 7",
-- "balance = 1500") lets one PC overwrite the other. Instead:
--   * stock changes are recorded as movements ("sold 2") and applied by the database once each;
--   * customer and supplier totals are kept up to date by the database from their ledgers.
--
-- Updating the app later: when it says the database needs an update, run this whole file again.
-- It only adds what is missing. (Version 3 adds returns/exchanges and bill history, section 5;
-- PCs still on the previous app version keep working with it.)

-- ---------------------------------------------------------------------------
-- 1. Stock movements
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id text primary key,
  product_id text not null,
  delta numeric not null,
  reason text,
  order_id text,
  created_at timestamp with time zone not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists idx_stock_movements_product_id on public.stock_movements(product_id);
create index if not exists idx_stock_movements_created_at on public.stock_movements(created_at);

alter table public.stock_movements enable row level security;
drop policy if exists "Authenticated access to stock_movements" on public.stock_movements;
create policy "Authenticated access to stock_movements" on public.stock_movements
  for all to authenticated
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);

-- Applies a stock change exactly once: a retry with the same id (e.g. after the reply was lost)
-- does nothing.
create or replace function public.apply_stock_movement(
  p_id text,
  p_product_id text,
  p_delta numeric,
  p_reason text default null,
  p_order_id text default null,
  p_created_at timestamp with time zone default now()
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.stock_movements (id, product_id, delta, reason, order_id, created_at)
  values (p_id, p_product_id, p_delta, p_reason, p_order_id, coalesce(p_created_at, now()))
  on conflict (id) do nothing;

  if not found then
    return; -- already applied
  end if;

  update public.products
  set stock_quantity = stock_quantity + p_delta
  where id = p_product_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Customer totals follow the customer ledger
-- ---------------------------------------------------------------------------
create or replace function public.pos_adjust_customer(p_id text, p_credit numeric, p_paid numeric)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.customers
  set total_credit = total_credit + p_credit,
      total_paid = total_paid + p_paid,
      balance = (total_credit + p_credit) - (total_paid + p_paid)
  where id = p_id;
$$;

-- A credit sale adds to credit; reversing a cancelled/edited credit bill takes it off credit
-- again; any other payment adds to paid. (Same rules the app uses on screen.)
create or replace function public.pos_customer_tx_totals()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  is_reversal boolean;
begin
  if tg_op <> 'INSERT' then
    is_reversal := old.type <> 'credit' and coalesce(old.description, '') ilike 'credit reversal%';
    perform public.pos_adjust_customer(
      old.customer_id,
      -(case when old.type = 'credit' then old.amount when is_reversal then -old.amount else 0 end),
      -(case when old.type <> 'credit' and not is_reversal then old.amount else 0 end)
    );
  end if;

  if tg_op <> 'DELETE' then
    is_reversal := new.type <> 'credit' and coalesce(new.description, '') ilike 'credit reversal%';
    perform public.pos_adjust_customer(
      new.customer_id,
      case when new.type = 'credit' then new.amount when is_reversal then -new.amount else 0 end,
      case when new.type <> 'credit' and not is_reversal then new.amount else 0 end
    );
  end if;

  return null;
end;
$$;

drop trigger if exists pos_customer_tx_totals on public.customer_transactions;
create trigger pos_customer_tx_totals
  after insert or update or delete on public.customer_transactions
  for each row execute function public.pos_customer_tx_totals();

-- ---------------------------------------------------------------------------
-- 3. Supplier totals follow the supplier ledger
-- ---------------------------------------------------------------------------
create or replace function public.pos_adjust_supplier(p_id text, p_purchased numeric, p_paid numeric)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.suppliers
  set total_purchased = total_purchased + p_purchased,
      total_paid = total_paid + p_paid,
      balance = (total_purchased + p_purchased) - (total_paid + p_paid)
  where id = p_id;
$$;

-- Positive amounts are purchases (invoices), negative amounts are payments to the supplier.
create or replace function public.pos_supplier_purchase_totals()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.pos_adjust_supplier(
      old.supplier_id,
      -(case when old.amount >= 0 then old.amount else 0 end),
      -(case when old.amount < 0 then -old.amount else 0 end)
    );
  end if;

  if tg_op <> 'DELETE' then
    perform public.pos_adjust_supplier(
      new.supplier_id,
      case when new.amount >= 0 then new.amount else 0 end,
      case when new.amount < 0 then -new.amount else 0 end
    );
  end if;

  return null;
end;
$$;

drop trigger if exists pos_supplier_purchase_totals on public.supplier_purchases;
create trigger pos_supplier_purchase_totals
  after insert or update or delete on public.supplier_purchases
  for each row execute function public.pos_supplier_purchase_totals();

-- ---------------------------------------------------------------------------
-- 4. Live updates between PCs (Supabase Realtime)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'products', 'orders', 'order_items', 'customers', 'customer_transactions',
      'customer_reminders', 'suppliers', 'supplier_purchases', 'supplier_payment_schedules',
      'categories', 'units', 'store_settings', 'stock_movements'
    ] loop
      if to_regclass('public.' || t) is not null and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Returns / exchanges and bill history (database version 3)
-- ---------------------------------------------------------------------------
-- A return or exchange is saved as its own bill, dated when the customer came back, and linked
-- to the bill the goods came from. Returned goods are lines with a negative quantity.
alter table public.orders add column if not exists original_order_id text references public.orders(id);
create index if not exists idx_orders_original_order_id on public.orders(original_order_id);

-- Who edited, cancelled or exchanged against a bill, when, why, and what it looked like before.
create table if not exists public.order_edit_logs (
  id text primary key,
  order_id text not null,
  edited_by text,
  edited_at timestamp with time zone not null default now(),
  changes_summary text,
  previous_order jsonb,
  previous_items jsonb
);
create index if not exists idx_order_edit_logs_order_id on public.order_edit_logs(order_id);

alter table public.order_edit_logs enable row level security;
drop policy if exists "Authenticated access to order_edit_logs" on public.order_edit_logs;
create policy "Authenticated access to order_edit_logs" on public.order_edit_logs
  for all to authenticated
  using ((select auth.uid()) is not null) with check ((select auth.uid()) is not null);

-- Live updates for bill history (the table did not exist yet when section 4 ran the first time).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_edit_logs'
  ) then
    alter publication supabase_realtime add table public.order_edit_logs;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Tells the app which features this database is ready for
-- ---------------------------------------------------------------------------
-- 2 = several PCs (sections 1-4), 3 = returns/exchanges and bill history (section 5).
create or replace function public.pos_schema_version()
returns integer
language sql
stable
as $$ select 3 $$;

notify pgrst, 'reload schema';
