-- Run this SQL in your Supabase SQL editor to set up the required tables and add a 'paid' field to jobs

create table if not exists cr_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  town text,
  postcode text,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists cr_jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references cr_customers(id) on delete cascade,
  scheduled_date date not null,
  scheduled_time time,
  price numeric(8,2) default 0,
  pvc_cleaning boolean default false,
  notes text,
  recurring text default 'none',
  completed boolean default false,
  paid boolean default false,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists cr_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  amount numeric(10,2) not null default 0,
  category text default 'misc',
  description text,
  created_at timestamptz default now()
);

-- Enable RLS
alter table cr_customers enable row level security;
alter table cr_jobs enable row level security;
alter table cr_expenses enable row level security;

-- Drop policies if they already exist, then recreate
drop policy if exists "allow all" on cr_customers;
drop policy if exists "allow all" on cr_jobs;
drop policy if exists "allow all" on cr_expenses;

create policy "allow all" on cr_customers for all using (true) with check (true);
create policy "allow all" on cr_jobs for all using (true) with check (true);
create policy "allow all" on cr_expenses for all using (true) with check (true);
