-- =====================================================================
-- MOVA Miles · database schema for Supabase
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: tables use "if not exists" and functions are replaced.
--
-- How it fits together
--   customers       one row per MOVA Miles member (linked to their login)
--   stamps          every scan at the till: how many coffees, which moment of the day, who stamped it
--   redemptions     every free coffee used
--   staff_members   baristas, each with a 4–6 digit PIN (stored hashed)
--   shop_accounts   logins allowed to use the till ('till') or the owner admin ('owner')
--
-- The website never writes to these tables directly. Every change goes through
-- the functions below, which check who is asking first.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------- Tables ----------------------------------------------------

create table if not exists public.customers (
  id               uuid primary key references auth.users(id) on delete cascade,
  first_name       text not null check (char_length(first_name) between 1 and 40),
  email            text not null,
  code             text not null unique,
  marketing_opt_in boolean not null default false,
  wallet_pass_id   text,                       -- filled in later, when the Wallet card is set up
  created_at       timestamptz not null default now()
);

create table if not exists public.staff_members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  pin_hash   text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_accounts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('till','owner')),
  shop       text not null default 'High Cross',
  created_at timestamptz not null default now()
);

create table if not exists public.stamps (
  id              bigint generated always as identity primary key,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  qty             int  not null check (qty between 1 and 6),
  moment          text not null check (moment in ('commute','mid','lunch','afternoon')),
  shop            text not null,
  staff_member_id uuid references public.staff_members(id),
  device_user_id  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid references auth.users(id) on delete set null
);
create index if not exists stamps_customer_idx on public.stamps (customer_id, created_at desc);
create index if not exists stamps_created_idx  on public.stamps (created_at desc);

create table if not exists public.redemptions (
  id              bigint generated always as identity primary key,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  shop            text not null,
  staff_member_id uuid references public.staff_members(id),
  device_user_id  uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid references auth.users(id) on delete set null
);
create index if not exists redemptions_customer_idx on public.redemptions (customer_id, created_at desc);

-- Row level security: customers can read only their own rows; nobody writes directly.
alter table public.customers     enable row level security;
alter table public.stamps        enable row level security;
alter table public.redemptions   enable row level security;
alter table public.staff_members enable row level security;
alter table public.shop_accounts enable row level security;

drop policy if exists "own customer row" on public.customers;
create policy "own customer row" on public.customers for select to authenticated using (id = auth.uid());
drop policy if exists "own stamps" on public.stamps;
create policy "own stamps" on public.stamps for select to authenticated using (customer_id = auth.uid());
drop policy if exists "own redemptions" on public.redemptions;
create policy "own redemptions" on public.redemptions for select to authenticated using (customer_id = auth.uid());

-- ---------- Settings --------------------------------------------------

-- Card size and the moments of the day (UK time). Change here if the rules change.
create or replace function private.card_size() returns int language sql immutable as $$ select 8 $$;

create or replace function public.moment_for(ts timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when (ts at time zone 'Europe/London')::time < time '09:30' then 'commute'
    when (ts at time zone 'Europe/London')::time < time '11:30' then 'mid'
    when (ts at time zone 'Europe/London')::time < time '13:30' then 'lunch'
    else 'afternoon'
  end
$$;

-- ---------- Private helpers (not callable from the website) ----------

create or replace function private.new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O or 1/I/L, easy to read aloud
  c text;
begin
  loop
    c := 'MV';
    for i in 1..4 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.customers where code = c);
  end loop;
  return c;
end $$;

create or replace function private.clean_code(p_code text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(regexp_replace(coalesce(p_code, ''), '^\s*mova:', '', 'i'), '\s', '', 'g'))
$$;

create or replace function private.coffee_total(p_customer uuid) returns int
language sql stable set search_path = '' as $$
  select coalesce(sum(qty), 0)::int from public.stamps where customer_id = p_customer and voided_at is null
$$;

create or replace function private.rewards_available(p_customer uuid) returns int
language sql stable set search_path = '' as $$
  select greatest(
    private.coffee_total(p_customer) / private.card_size()
      - (select count(*)::int from public.redemptions where customer_id = p_customer and voided_at is null),
    0)
$$;

-- Everything the customer's card and the till need, as one JSON object.
create or replace function private.card_json(p_customer uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_total    int := private.coffee_total(p_customer);
  v_size     int := private.card_size();
  v_progress int := v_total % v_size;
  v_result   jsonb;
begin
  select jsonb_build_object(
    'first_name',        c.first_name,
    'code',              c.code,
    'member_since',      c.created_at,
    'marketing_opt_in',  c.marketing_opt_in,
    'card_size',         v_size,
    'progress',          v_progress,
    'total_coffees',     v_total,
    'rewards_available', private.rewards_available(p_customer),
    -- One entry per filled stop on the current card, oldest first.
    'stops', coalesce((
        select jsonb_agg(jsonb_build_object('moment', x.moment, 'at', x.created_at) order by x.created_at, x.id)
        from (
          select s.id, s.moment, s.created_at
          from public.stamps s cross join generate_series(1, s.qty)
          where s.customer_id = p_customer and s.voided_at is null
          order by s.created_at desc, s.id desc
          limit v_progress
        ) x), '[]'::jsonb),
    -- Lifetime coffees per moment of the day. These never reset.
    'moments', (
        select jsonb_build_object(
          'commute',   coalesce(sum(s.qty) filter (where s.moment = 'commute'), 0),
          'mid',       coalesce(sum(s.qty) filter (where s.moment = 'mid'), 0),
          'lunch',     coalesce(sum(s.qty) filter (where s.moment = 'lunch'), 0),
          'afternoon', coalesce(sum(s.qty) filter (where s.moment = 'afternoon'), 0))
        from public.stamps s where s.customer_id = p_customer and s.voided_at is null),
    'last_stamp_at', (select max(s.created_at) from public.stamps s where s.customer_id = p_customer and s.voided_at is null),
    'history', coalesce((
        select jsonb_agg(jsonb_build_object('type', h.kind, 'qty', h.qty, 'moment', h.moment, 'at', h.at) order by h.at desc)
        from (
          select * from (
            select 'stamp' as kind, s.qty, s.moment, s.created_at as at
              from public.stamps s where s.customer_id = p_customer and s.voided_at is null
            union all
            select 'reward', null, null, r.created_at
              from public.redemptions r where r.customer_id = p_customer and r.voided_at is null
          ) u order by u.at desc limit 10
        ) h), '[]'::jsonb)
  ) into v_result
  from public.customers c where c.id = p_customer;
  return v_result;
end $$;

-- The signed-in shop login, or an error if this login isn't a shop account.
create or replace function private.require_shop(p_owner_only boolean default false) returns public.shop_accounts
language plpgsql stable set search_path = '' as $$
declare acc public.shop_accounts;
begin
  select * into acc from public.shop_accounts where user_id = auth.uid();
  if not found then raise exception 'not_shop_account' using errcode = '42501'; end if;
  if p_owner_only and acc.role <> 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;
  return acc;
end $$;

create or replace function private.check_staff(p_staff uuid, p_pin text) returns public.staff_members
language plpgsql stable set search_path = '' as $$
declare m public.staff_members;
begin
  select * into m from public.staff_members
   where id = p_staff and active and pin_hash = extensions.crypt(coalesce(p_pin, ''), pin_hash);
  if not found then raise exception 'wrong_pin' using errcode = '28000'; end if;
  return m;
end $$;

create or replace function private.find_customer(p_code text) returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.customers where code = private.clean_code(p_code);
  if v is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return v;
end $$;

-- ---------- Customer functions ---------------------------------------

-- Called after the customer opens their sign-in link. Creates their card the first time,
-- using the first name and marketing choice they typed on the sign-up form.
create or replace function public.ensure_customer() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  u    record;
  name text;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not exists (select 1 from public.customers where id = uid) then
    select email, raw_user_meta_data into u from auth.users where id = uid;
    name := left(nullif(trim(u.raw_user_meta_data->>'first_name'), ''), 40);
    insert into public.customers (id, first_name, email, code, marketing_opt_in)
    values (uid, coalesce(name, 'Friend'), coalesce(u.email, ''), private.new_code(),
            coalesce((u.raw_user_meta_data->>'marketing_opt_in')::boolean, false))
    on conflict (id) do nothing;
  end if;
  return private.card_json(uid);
end $$;

create or replace function public.my_card() returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.card_json(auth.uid())
$$;

create or replace function public.set_my_details(p_first_name text, p_marketing_opt_in boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  update public.customers
     set first_name = coalesce(left(nullif(trim(p_first_name), ''), 40), first_name),
         marketing_opt_in = coalesce(p_marketing_opt_in, marketing_opt_in)
   where id = auth.uid();
  return private.card_json(auth.uid());
end $$;

-- Deletes the member's login, card and history for good (their right to erasure under UK GDPR).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- Till functions (shop logins only) -------------------------

create or replace function public.till_whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare acc public.shop_accounts := private.require_shop();
begin
  return jsonb_build_object('role', acc.role, 'shop', acc.shop);
end $$;

create or replace function public.till_staff() returns table (id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_shop();
  return query select s.id, s.name from public.staff_members s where s.active order by s.name;
end $$;

create or replace function public.till_check_pin(p_staff uuid, p_pin text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_shop();
  perform private.check_staff(p_staff, p_pin);
  return true;
exception when sqlstate '28000' then
  return false;
end $$;

create or replace function public.till_lookup(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_shop();
  return private.card_json(private.find_customer(p_code));
end $$;

-- Adds stamps for one order. If the customer was stamped in the last 10 minutes it returns
-- status 'confirm' instead, and the till asks the barista before calling again with p_force = true.
create or replace function public.till_add_stamps(p_code text, p_qty int, p_staff uuid, p_pin text, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  acc      public.shop_accounts := private.require_shop();
  member   public.staff_members := private.check_staff(p_staff, p_pin);
  cust     uuid := private.find_customer(p_code);
  v_last   timestamptz;
  v_before int;
  v_moment text := public.moment_for(now());
begin
  if p_qty is null or p_qty not between 1 and 6 then raise exception 'bad_quantity' using errcode = '22023'; end if;
  perform 1 from public.customers where id = cust for update;  -- one stamp at a time per customer

  select max(created_at) into v_last from public.stamps where customer_id = cust and voided_at is null;
  if not coalesce(p_force, false) and v_last > now() - interval '10 minutes' then
    return jsonb_build_object('status', 'confirm', 'last_stamp_at', v_last);
  end if;

  v_before := private.coffee_total(cust) / private.card_size();
  insert into public.stamps (customer_id, qty, moment, shop, staff_member_id, device_user_id)
  values (cust, p_qty, v_moment, acc.shop, member.id, auth.uid());

  return jsonb_build_object(
    'status', 'ok',
    'moment', v_moment,
    'rewards_earned', private.coffee_total(cust) / private.card_size() - v_before,
    'card', private.card_json(cust));
end $$;

create or replace function public.till_redeem(p_code text, p_staff uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  acc    public.shop_accounts := private.require_shop();
  member public.staff_members := private.check_staff(p_staff, p_pin);
  cust   uuid := private.find_customer(p_code);
begin
  perform 1 from public.customers where id = cust for update;
  if private.rewards_available(cust) < 1 then raise exception 'no_reward' using errcode = 'P0001'; end if;
  insert into public.redemptions (customer_id, shop, staff_member_id, device_user_id)
  values (cust, acc.shop, member.id, auth.uid());
  return jsonb_build_object('status', 'ok', 'card', private.card_json(cust));
end $$;

-- Today's stamps and free coffees at this shop, newest first (UK date).
create or replace function public.till_today() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  acc public.shop_accounts := private.require_shop();
  day_start timestamptz := (date_trunc('day', now() at time zone 'Europe/London')) at time zone 'Europe/London';
begin
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.at desc)
    from (
      select 'stamp' as kind, s.id, s.qty, s.moment, s.created_at as at, s.voided_at,
             c.first_name as customer, c.code, m.name as staff
        from public.stamps s
        join public.customers c on c.id = s.customer_id
        left join public.staff_members m on m.id = s.staff_member_id
       where s.created_at >= day_start and s.shop = acc.shop
      union all
      select 'reward', r.id, null, null, r.created_at, r.voided_at, c.first_name, c.code, m.name
        from public.redemptions r
        join public.customers c on c.id = r.customer_id
        left join public.staff_members m on m.id = r.staff_member_id
       where r.created_at >= day_start and r.shop = acc.shop
      order by at desc
      limit 100
    ) t), '[]'::jsonb);
end $$;

-- Undo a stamp or free coffee. Staff can undo within 30 minutes; the owner login can undo anything.
create or replace function public.till_void(p_kind text, p_id bigint, p_staff uuid, p_pin text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  acc    public.shop_accounts := private.require_shop();
  member public.staff_members := private.check_staff(p_staff, p_pin);
  v_at   timestamptz;
begin
  if p_kind = 'stamp' then
    select created_at into v_at from public.stamps where id = p_id and voided_at is null;
  elsif p_kind = 'reward' then
    select created_at into v_at from public.redemptions where id = p_id and voided_at is null;
  else
    raise exception 'bad_kind' using errcode = '22023';
  end if;
  if v_at is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if acc.role <> 'owner' and v_at < now() - interval '30 minutes' then
    raise exception 'too_old_to_undo' using errcode = '42501';
  end if;
  if p_kind = 'stamp' then
    update public.stamps set voided_at = now(), voided_by = auth.uid() where id = p_id;
  else
    update public.redemptions set voided_at = now(), voided_by = auth.uid() where id = p_id;
  end if;
  return true;
end $$;

-- ---------- Owner functions ------------------------------------------

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  day_start  timestamptz := (date_trunc('day',  now() at time zone 'Europe/London')) at time zone 'Europe/London';
  week_start timestamptz := (date_trunc('week', now() at time zone 'Europe/London')) at time zone 'Europe/London';
begin
  perform private.require_shop(true);
  return jsonb_build_object(
    'members',          (select count(*) from public.customers),
    'members_this_week',(select count(*) from public.customers where created_at >= week_start),
    'marketing_opt_ins',(select count(*) from public.customers where marketing_opt_in),
    'coffees_today',    (select coalesce(sum(qty),0) from public.stamps where voided_at is null and created_at >= day_start),
    'coffees_this_week',(select coalesce(sum(qty),0) from public.stamps where voided_at is null and created_at >= week_start),
    'free_coffees_used',(select count(*) from public.redemptions where voided_at is null),
    'moments', (select jsonb_build_object(
        'commute',   coalesce(sum(qty) filter (where moment='commute'),0),
        'mid',       coalesce(sum(qty) filter (where moment='mid'),0),
        'lunch',     coalesce(sum(qty) filter (where moment='lunch'),0),
        'afternoon', coalesce(sum(qty) filter (where moment='afternoon'),0))
      from public.stamps where voided_at is null),
    'customers', coalesce((
      select jsonb_agg(row_to_json(t) order by t.last_visit desc nulls last)
      from (
        select c.first_name, c.email, c.code, c.marketing_opt_in, c.created_at,
               private.coffee_total(c.id) as coffees,
               private.coffee_total(c.id) % private.card_size() as progress,
               private.rewards_available(c.id) as rewards_available,
               (select max(created_at) from public.stamps s where s.customer_id = c.id and s.voided_at is null) as last_visit,
               (select s.moment from public.stamps s where s.customer_id = c.id and s.voided_at is null
                 group by s.moment order by sum(s.qty) desc limit 1) as top_moment
          from public.customers c
         limit 2000
      ) t), '[]'::jsonb)
  );
end $$;

create or replace function public.admin_staff() returns table (id uuid, name text, active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_shop(true);
  return query select s.id, s.name, s.active, s.created_at from public.staff_members s order by s.active desc, s.name;
end $$;

create or replace function public.admin_save_staff(p_id uuid, p_name text, p_pin text, p_active boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid := p_id;
begin
  perform private.require_shop(true);
  if p_pin is not null and p_pin !~ '^[0-9]{4,6}$' then raise exception 'pin_must_be_4_to_6_digits' using errcode = '22023'; end if;
  if v is null then
    if p_pin is null then raise exception 'pin_required' using errcode = '22023'; end if;
    insert into public.staff_members (name, pin_hash, active)
    values (trim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf')), coalesce(p_active, true))
    returning id into v;
  else
    update public.staff_members
       set name     = coalesce(nullif(trim(p_name), ''), name),
           pin_hash = case when p_pin is null then pin_hash else extensions.crypt(p_pin, extensions.gen_salt('bf')) end,
           active   = coalesce(p_active, active)
     where id = v;
  end if;
  return v;
end $$;

-- ---------- Who may call what ----------------------------------------

revoke all on schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'ensure_customer()', 'my_card()', 'set_my_details(text, boolean)', 'delete_my_account()',
    'till_whoami()', 'till_staff()', 'till_check_pin(uuid, text)', 'till_lookup(text)',
    'till_add_stamps(text, int, uuid, text, boolean)', 'till_redeem(text, uuid, text)',
    'till_today()', 'till_void(text, bigint, uuid, text)',
    'admin_overview()', 'admin_staff()', 'admin_save_staff(uuid, text, text, boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
