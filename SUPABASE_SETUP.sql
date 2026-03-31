-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Categories Table
create table public.categories (
  id text primary key,
  name text not null,
  description text
);

-- Units Table
create table public.units (
  id text primary key,
  name text not null unique,
  description text
);

-- Products Table
create table public.products (
  id text primary key,
  sku text not null,
  name text not null,
  description text,
  category_id text references public.categories(id),
  unit_id text references public.units(id),
  cost_price numeric not null default 0,
  selling_price numeric not null default 0,
  stock_quantity integer not null default 0,
  low_stock_threshold integer not null default 0
);

-- Add inventory tracking columns
alter table public.products add column if not exists expiry_date date;
alter table public.products add column if not exists barcode text;
alter table public.products add column if not exists barcode_enabled boolean not null default false;

-- Customers Table (Digi Khata)
create table public.customers (
  id text primary key,
  name text not null,
  phone text not null,
  address text not null,
  nic text, -- National Identity Card (optional)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  total_credit numeric not null default 0,
  total_paid numeric not null default 0,
  balance numeric not null default 0
);

alter table public.customers add column if not exists nic text;
alter table public.customers add column if not exists total_credit numeric not null default 0;
alter table public.customers add column if not exists total_paid numeric not null default 0;
alter table public.customers add column if not exists balance numeric not null default 0;

-- Customer Transactions Table (Credit Ledger)
create table public.customer_transactions (
  id text primary key,
  customer_id text references public.customers(id) on delete cascade,
  order_id text, -- Link to order if it's a credit sale
  type text not null, -- 'credit' or 'payment'
  amount numeric not null default 0,
  payment_method text, -- 'cash' or 'card' for repayments
  card_fee_rate numeric default 0,
  card_fee_amount numeric default 0,
  total_charged numeric,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.customer_transactions add column if not exists order_id text;
alter table public.customer_transactions add column if not exists payment_method text;
alter table public.customer_transactions add column if not exists card_fee_rate numeric default 0;
alter table public.customer_transactions add column if not exists card_fee_amount numeric default 0;
alter table public.customer_transactions add column if not exists total_charged numeric;

-- Customer Reminders Table (Udhaar reminders)
create table public.customer_reminders (
  id text primary key,
  customer_id text references public.customers(id) on delete cascade,
  frequency text not null, -- 'daily' | 'weekly' | 'monthly'
  next_reminder_date date not null,
  is_active boolean not null default true,
  note text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_triggered_at timestamp with time zone
);

alter table public.customer_reminders add column if not exists frequency text;
alter table public.customer_reminders add column if not exists next_reminder_date date;
alter table public.customer_reminders add column if not exists is_active boolean not null default true;
alter table public.customer_reminders add column if not exists note text;
alter table public.customer_reminders add column if not exists last_triggered_at timestamp with time zone;

-- Suppliers Table
create table public.suppliers (
  id text primary key,
  name text not null,
  phone text not null,
  address text not null,
  contact_person text,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  total_purchased numeric not null default 0,
  total_paid numeric not null default 0,
  balance numeric not null default 0
);

alter table public.suppliers add column if not exists contact_person text;
alter table public.suppliers add column if not exists notes text;
alter table public.suppliers add column if not exists total_purchased numeric not null default 0;
alter table public.suppliers add column if not exists total_paid numeric not null default 0;
alter table public.suppliers add column if not exists balance numeric not null default 0;

-- Supplier Purchases Table
create table public.supplier_purchases (
  id text primary key,
  supplier_id text references public.suppliers(id) on delete cascade,
  description text not null,
  amount numeric not null default 0,
  purchase_date date not null,
  invoice_number text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.supplier_purchases add column if not exists purchase_date date;
alter table public.supplier_purchases add column if not exists invoice_number text;

-- Supplier Payment Schedules Table
create table public.supplier_payment_schedules (
  id text primary key,
  supplier_id text references public.suppliers(id) on delete cascade,
  frequency text not null, -- 'daily' | 'weekly' | 'monthly'
  next_payment_date date not null,
  amount numeric not null default 0,
  is_active boolean not null default true,
  note text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_paid_at timestamp with time zone
);

alter table public.supplier_payment_schedules add column if not exists frequency text;
alter table public.supplier_payment_schedules add column if not exists next_payment_date date;
alter table public.supplier_payment_schedules add column if not exists amount numeric not null default 0;
alter table public.supplier_payment_schedules add column if not exists is_active boolean not null default true;
alter table public.supplier_payment_schedules add column if not exists note text;
alter table public.supplier_payment_schedules add column if not exists last_paid_at timestamp with time zone;

-- Orders Table
create table public.orders (
  id text primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  cashier_id text,
  cashier_name text,
  subtotal numeric not null default 0,
  tax_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  total_amount numeric not null default 0,
  payment_method text, -- 'cash', 'card', 'transfer', 'credit'
  status text default 'completed', -- 'completed', 'refunded', 'credit'
  amount_tendered numeric,
  change_given numeric,
  -- Client info (for receipts)
  client_name text,
  client_phone text,
  -- Transfer payment details
  transfer_type text, -- 'bank', 'jazzcash', 'easypaisa'
  transaction_id text,
  -- Credit sale customer link
  customer_id text references public.customers(id),
  -- Card fee
  card_fee_amount numeric default 0,
  card_fee_rate numeric default 0
);

alter table public.orders add column if not exists client_name text;
alter table public.orders add column if not exists client_phone text;
alter table public.orders add column if not exists transfer_type text;
alter table public.orders add column if not exists transaction_id text;
alter table public.orders add column if not exists customer_id text references public.customers(id);
alter table public.orders add column if not exists card_fee_amount numeric default 0;
alter table public.orders add column if not exists card_fee_rate numeric default 0;

-- Order Items Table
create table public.order_items (
  id text primary key,
  order_id text references public.orders(id),
  product_id text references public.products(id),
  product_name text,
  product_sku text,
  quantity integer not null default 1,
  unit_price_at_sale numeric not null,
  discount_amount numeric default 0
);

-- Store Settings Table
create table public.store_settings (
  id integer primary key default 1,
  store_name text,
  address text,
  phone text,
  tax_rate numeric default 0,
  card_fee_percent numeric default 2,
  receipt_footer_message text,
  allow_negative_stock boolean default false,
  logo text
);

alter table public.store_settings add column if not exists card_fee_percent numeric default 2;

-- Insert default settings
insert into public.store_settings (id, store_name, address, phone, tax_rate, card_fee_percent, receipt_footer_message, allow_negative_stock)
values (1, 'My Store', '123 Main Street', '(555) 123-4567', 10, 2, 'Thank you for your purchase!', false)
on conflict (id) do nothing;

update public.store_settings set card_fee_percent = 2 where id = 1;

-- Insert default categories
insert into public.categories (id, name, description) values
  ('cat_electronics', 'Electronics', 'Electronic devices and accessories'),
  ('cat_groceries', 'Groceries', 'Food and grocery items'),
  ('cat_clothing', 'Clothing', 'Apparel and fashion items'),
  ('cat_beverages', 'Beverages', 'Drinks and beverages'),
  ('cat_personal_care', 'Personal Care', 'Health and beauty products'),
  ('cat_home_living', 'Home & Living', 'Home decor and furniture'),
  ('cat_sports', 'Sports', 'Sports equipment and accessories'),
  ('cat_books', 'Books & Stationery', 'Books, office and school supplies')
on conflict (id) do nothing;

-- Enable Row Level Security (RLS)
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.customer_transactions enable row level security;
alter table public.customer_reminders enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_purchases enable row level security;
alter table public.supplier_payment_schedules enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.store_settings enable row level security;

-- Create policies to allow anonymous access (since we are using mock auth in the frontend)
-- In a real production app with Supabase Auth, you would restrict this to authenticated users.

create policy "Allow public access to categories" on public.categories for all using (true);
create policy "Allow public access to products" on public.products for all using (true);
create policy "Allow public access to customers" on public.customers for all using (true);
create policy "Allow public access to customer_transactions" on public.customer_transactions for all using (true);
create policy "Allow public access to customer_reminders" on public.customer_reminders for all using (true);
create policy "Allow public access to suppliers" on public.suppliers for all using (true);
create policy "Allow public access to supplier_purchases" on public.supplier_purchases for all using (true);
create policy "Allow public access to supplier_payment_schedules" on public.supplier_payment_schedules for all using (true);
create policy "Allow public access to orders" on public.orders for all using (true);
create policy "Allow public access to order_items" on public.order_items for all using (true);
create policy "Allow public access to store_settings" on public.store_settings for all using (true);

-- Create indexes for better query performance
create index idx_products_category on public.products(category_id);
create index idx_orders_created_at on public.orders(created_at);
create index idx_orders_customer_id on public.orders(customer_id);
create index idx_order_items_order_id on public.order_items(order_id);
create index idx_customer_transactions_customer_id on public.customer_transactions(customer_id);
create index idx_customer_reminders_customer_id on public.customer_reminders(customer_id);
create index idx_customer_reminders_next_date on public.customer_reminders(next_reminder_date);
create index idx_customers_phone on public.customers(phone);
create index idx_suppliers_phone on public.suppliers(phone);
create index idx_supplier_purchases_supplier_id on public.supplier_purchases(supplier_id);
create index idx_supplier_payment_schedules_supplier_id on public.supplier_payment_schedules(supplier_id);
create index idx_supplier_payment_schedules_next_date on public.supplier_payment_schedules(next_payment_date);
