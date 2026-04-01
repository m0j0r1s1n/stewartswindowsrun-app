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

-- Enable RLS (optional but recommended)
alter table cr_customers enable row level security;
alter table cr_jobs enable row level security;
create policy "allow all" on cr_customers for all using (true) with check (true);
create policy "allow all" on cr_jobs for all using (true) with check (true);
