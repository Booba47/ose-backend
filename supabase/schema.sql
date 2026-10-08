-- =========================================================
-- OSE - SCHÉMA COMPLET DE LA BASE DE DONNÉES
-- =========================================================

create extension if not exists "pgcrypto";

-- =========================================================
-- 1. PROFILS UTILISATEURS
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,

  name text not null,
  birth_date date not null,
  city text not null default '',
  bio text not null default '',
  looking_for text not null default '',

  interests text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 2. PHOTOS
-- =========================================================

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  storage_path text not null,

  photo_url text,

  position integer not null default 0,

  created_at timestamptz not null default now()
);

-- =========================================================
-- 3. LIKES
-- =========================================================

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  liked_user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  unique(user_id, liked_user_id),

  check(user_id <> liked_user_id)
);

-- =========================================================
-- 4. PASSES
-- =========================================================

create table if not exists public.passes (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  passed_user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  unique(user_id, passed_user_id),

  check(user_id <> passed_user_id)
);

-- =========================================================
-- 5. MATCHS
-- =========================================================

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),

  user_one_id uuid not null
    references public.profiles(id)
    on delete cascade,

  user_two_id uuid not null
    references public.profiles(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  unique(user_one_id, user_two_id),

  check(user_one_id <> user_two_id)
);

-- =========================================================
-- 6. CONVERSATIONS
-- =========================================================

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),

  match_id uuid not null unique
    references public.matches(id)
    on delete cascade,

  created_at timestamptz not null default now()
);

-- =========================================================
-- 7. MESSAGES
-- =========================================================

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
    references public.conversations(id)
    on delete cascade,

  sender_id uuid not null
    references public.profiles(id)
    on delete cascade,

  text text not null,

  is_read boolean not null default false,

  created_at timestamptz not null default now()
);

-- =========================================================
-- 8. BLOCAGES
-- =========================================================

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  blocked_user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  unique(user_id, blocked_user_id),

  check(user_id <> blocked_user_id)
);

-- =========================================================
-- 9. SIGNALEMENTS
-- =========================================================

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),

  reporter_id uuid not null
    references public.profiles(id)
    on delete cascade,

  reported_user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  reason text not null,

  created_at timestamptz not null default now()
);

-- =========================================================
-- 10. NOTIFICATIONS
-- =========================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  message text not null,

  is_read boolean not null default false,

  created_at timestamptz not null default now()
);

-- =========================================================
-- 11. PRÉFÉRENCES
-- =========================================================

create table if not exists public.preferences (
  user_id uuid primary key
    references public.profiles(id)
    on delete cascade,

  notifications_enabled boolean not null default true,

  show_online_status boolean not null default true,

  show_read_receipts boolean not null default true,

  updated_at timestamptz not null default now()
);

-- =========================================================
-- 12. INDEX
-- =========================================================

create index if not exists idx_photos_user_id
on public.photos(user_id);

create index if not exists idx_likes_user_id
on public.likes(user_id);

create index if not exists idx_likes_liked_user_id
on public.likes(liked_user_id);

create index if not exists idx_passes_user_id
on public.passes(user_id);

create index if not exists idx_matches_user_one
on public.matches(user_one_id);

create index if not exists idx_matches_user_two
on public.matches(user_two_id);

create index if not exists idx_messages_conversation
on public.messages(conversation_id);

create index if not exists idx_messages_sender
on public.messages(sender_id);

create index if not exists idx_blocks_user
on public.blocks(user_id);

create index if not exists idx_reports_reported_user
on public.reports(reported_user_id);

create index if not exists idx_notifications_user
on public.notifications(user_id);

-- =========================================================
-- 13. MISE À JOUR AUTOMATIQUE DE updated_at
-- =========================================================

create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at
on public.profiles;

create trigger profiles_updated_at
before update on public.profiles
for each row
execute function public.update_updated_at();

drop trigger if exists preferences_updated_at
on public.preferences;

create trigger preferences_updated_at
before update on public.preferences
for each row
execute function public.update_updated_at();

-- =========================================================
-- FIN DU SCHÉMA OSE
-- =========================================================
