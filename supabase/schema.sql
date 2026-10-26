-- My Daily Planner: Supabase schema. Run once in Supabase > SQL Editor.
-- One generic table keeps the app extensible: new record kinds need no migration.

create table if not exists public.records (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('appts','tasks','follows','reports','settings')),
  id         text not null check (length(id) between 1 and 80),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 262144),
  updated_at timestamptz not null,                    -- client edit time (conflict rule: newest edit wins)
  deleted    boolean not null default false,          -- tombstone so deletes reach other devices
  synced_at  timestamptz not null default now(),      -- server time (pull cursor)
  primary key (user_id, kind, id)
);
create index if not exists records_pull_idx on public.records (user_id, synced_at);

alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Idempotent upsert: the same change sent twice never creates a duplicate; an older edit never overwrites a newer one.
create or replace function public.upsert_record(p_kind text, p_id text, p_data jsonb, p_updated timestamptz, p_deleted boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare cur timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select updated_at into cur from records where user_id = auth.uid() and kind = p_kind and id = p_id;
  if cur is not null and cur > p_updated then
    return jsonb_build_object('applied', false);
  end if;
  insert into records (user_id, kind, id, data, updated_at, deleted, synced_at)
  values (auth.uid(), p_kind, p_id, coalesce(p_data,'{}'::jsonb), p_updated, coalesce(p_deleted,false), now())
  on conflict (user_id, kind, id) do update
    set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, synced_at = now();
  return jsonb_build_object('applied', true);
end $$;

-- Realtime: other devices are told when a row changes
alter publication supabase_realtime add table public.records;

-- Web Push subscriptions (one row per browser/device)
create table if not exists public.push_subscriptions (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null,
  keys     jsonb not null,
  tz       text not null default 'UTC',
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subs" on public.push_subscriptions;
create policy "own subs" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Prevents the scheduler from sending the same reminder twice
create table if not exists public.reminders_sent (
  user_id uuid not null, key text not null, sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.reminders_sent enable row level security;   -- no policies: only the service role (Edge Function) can touch it
