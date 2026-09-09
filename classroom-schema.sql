-- ============================================================
-- 5th Semester (CSE) — ডাটাবেস সেটআপ
-- কোথায় চালাবেন: Supabase Dashboard → SQL Editor → New query
-- পুরো স্ক্রিপ্ট পেস্ট করে RUN চাপুন। একাধিকবার চালালেও সমস্যা নেই।
-- ============================================================

-- ১) পোস্ট রাখার টেবিল
create table if not exists public.classroom_posts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  subject     text not null,
  description text default '',
  files       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.classroom_posts enable row level security;

drop policy if exists "classroom_posts_select" on public.classroom_posts;
create policy "classroom_posts_select" on public.classroom_posts
  for select using (true);

drop policy if exists "classroom_posts_insert" on public.classroom_posts;
create policy "classroom_posts_insert" on public.classroom_posts
  for insert with check (true);

drop policy if exists "classroom_posts_delete" on public.classroom_posts;
create policy "classroom_posts_delete" on public.classroom_posts
  for delete using (true);

-- ২) ছবি/PDF রাখার পাবলিক স্টোরেজ বাকেট
insert into storage.buckets (id, name, public)
values ('classroom-files', 'classroom-files', true)
on conflict (id) do update set public = true;

drop policy if exists "classroom_files_select" on storage.objects;
create policy "classroom_files_select" on storage.objects
  for select using (bucket_id = 'classroom-files');

drop policy if exists "classroom_files_insert" on storage.objects;
create policy "classroom_files_insert" on storage.objects
  for insert with check (bucket_id = 'classroom-files');

drop policy if exists "classroom_files_update" on storage.objects;
create policy "classroom_files_update" on storage.objects
  for update using (bucket_id = 'classroom-files')
  with check (bucket_id = 'classroom-files');

drop policy if exists "classroom_files_delete" on storage.objects;
create policy "classroom_files_delete" on storage.objects
  for delete using (bucket_id = 'classroom-files');

-- ৩) (ঐচ্ছিক) রিয়েলটাইম — নতুন পোস্ট সাথে সাথে সবার স্ক্রিনে দেখা যাবে
do $$
begin
  alter publication supabase_realtime add table public.classroom_posts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
