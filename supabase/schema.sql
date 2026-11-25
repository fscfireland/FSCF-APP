-- FSCF Doors — cloud database (Supabase / Postgres), for phase 2: sync.
-- Not used yet. The app currently stores everything on the phone; this is
-- the matching cloud layout so sync and Claude access can be switched on.
--
-- Run in the Supabase SQL editor of a project created in the EU (Ireland,
-- eu-west-1) region. Every row belongs to a user (owner), and Row Level
-- Security means nobody can read a row unless they are logged in as its owner.

create table if not exists projects (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id),
  client text, site text, address text, date date,
  next_pin int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists plans (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id),
  project_id uuid not null references projects(id),
  name text, "order" int default 0,
  image_path text,          -- file in the private 'plans' storage bucket
  width int, height int, source_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists doors (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id),
  project_id uuid not null references projects(id),
  plan_id uuid references plans(id),
  pin_no int, x real, y real,          -- pin position as 0–1 fractions of the plan
  ref text, location text, door_type text, leaf text,
  status text not null default 'not_inspected'
    check (status in ('not_inspected','pass','fail','no_access','repaired')),
  defects jsonb not null default '[]', -- [{label, remedial, qty}]
  action text, notes text,
  inspected_on date, inspected_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists photos (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id),
  project_id uuid not null references projects(id),
  door_id uuid not null references doors(id),
  image_path text,          -- file in the private 'photos' storage bucket
  width int, height int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

-- Project documents: certificates, O&M manuals, quotes, reports
create table if not exists files (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id),
  project_id uuid not null references projects(id),
  name text not null,
  folder text,
  mime_type text,
  size_bytes bigint,
  pages int,
  notes text,
  file_path text,           -- file in the private 'files' storage bucket
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists files_project on files(project_id);
create index if not exists doors_project on doors(project_id);
create index if not exists plans_project on plans(project_id);
create index if not exists photos_door on photos(door_id);

-- One row per defect: the shape Claude (and the pricing workbook) wants.
create or replace view door_defects with (security_invoker = true) as
select p.site, p.client, d.project_id, d.pin_no, d.ref, d.location, d.door_type, d.status,
       x->>'label' as defect, x->>'remedial' as remedial, coalesce((x->>'qty')::int, 1) as qty
from doors d
join projects p on p.id = d.project_id
cross join lateral jsonb_array_elements(d.defects) x
where not d.deleted and not p.deleted;

-- Row Level Security: owner-only access
do $$
declare t text;
begin
  foreach t in array array['projects','plans','doors','photos','files'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists owner_all on %I', t);
    execute format('create policy owner_all on %I for all using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;

-- Private storage buckets for drawings and photos
insert into storage.buckets (id, name, public) values ('plans', 'plans', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict do nothing;

drop policy if exists "own files" on storage.objects;
create policy "own files" on storage.objects for all
  using (bucket_id in ('plans','photos','files') and owner = auth.uid())
  with check (bucket_id in ('plans','photos','files') and owner = auth.uid());
