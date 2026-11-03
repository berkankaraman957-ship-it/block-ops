-- ============================================================================
-- BLOCK OPS — Supabase schema
-- Supabase panelinde: SQL Editor → New query → bu dosyanın TAMAMINI yapıştır → RUN.
-- Birden fazla kez çalıştırmak güvenlidir (if not exists).
--
-- Güvenlik: RLS açık ve hiçbir "policy" yok → tarayıcılar (anon key) tablolara
-- ERİŞEMEZ. Sadece oyun sunucusu, Render'daki SUPABASE_SERVICE_KEY ile erişir.
-- ============================================================================

create table if not exists public.players (
  id           text primary key,                 -- arkadaş kodu (ör. K7QX2MP)
  token_hash   text not null,                    -- sha256(hesap anahtarı) — anahtarın kendisi asla saklanmaz
  name         text not null default 'Oyuncu',
  xp           integer not null default 0,
  level        integer not null default 1,
  coins        integer not null default 0,
  premium      boolean not null default false,
  rank_points  integer not null default 1000,
  stats        jsonb not null default '{}'::jsonb,
  inventory    jsonb not null default '[]'::jsonb,
  equipped     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.matches (
  id          bigserial primary key,
  player_id   text not null references public.players(id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists matches_player_idx on public.matches (player_id, created_at desc);

create table if not exists public.reports (
  id           bigserial primary key,
  reporter     text not null,
  target       text not null default '',
  target_name  text not null default '',
  reason       text not null default '',
  room         text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists reports_target_idx on public.reports (target, created_at desc);

-- Liderlik tablosu sorguları için
create index if not exists players_rank_idx on public.players (rank_points desc);
create index if not exists players_xp_idx on public.players (xp desc);

alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.reports enable row level security;

-- Eski maç geçmişini temizlemek için (isteğe bağlı, elle çalıştır):
--   delete from public.matches where created_at < now() - interval '180 days';
--   delete from public.reports where created_at < now() - interval '365 days';
