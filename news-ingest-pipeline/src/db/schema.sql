create table if not exists media (
  slug        text primary key,
  name        text not null,
  feed_url    text,
  base_url    text,
  created_at  timestamptz default now()
);

-- PK is (guid, medium_slug); url has a separate unique constraint.
create table if not exists articles (
  url             text not null,
  guid            text not null,
  medium_slug     text not null references media(slug),
  title           text not null,
  summary         text,
  body            text,
  author          text,
  published_at    timestamptz,
  language        text,
  topics          text[],
  extraction_path text,
  created_at      timestamptz default now(),
  primary key (guid, medium_slug)
);

-- Required for upsert onConflict:'url' — idempotent.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'articles_url_key' and conrelid = 'articles'::regclass
  ) then
    alter table articles add constraint articles_url_key unique (url);
  end if;
end $$;

create index if not exists articles_published_at_idx on articles (published_at desc);
create index if not exists articles_medium_slug_idx  on articles (medium_slug);
create index if not exists articles_topics_gin_idx   on articles using gin (topics);

create table if not exists ingest_runs (
  id              bigserial primary key,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  feeds_processed int  not null default 0,
  articles_found  int  not null default 0,
  articles_new    int  not null default 0,
  articles_failed int  not null default 0
);

create table if not exists ingest_attempts (
  id          bigserial primary key,
  run_id      bigint not null references ingest_runs(id),
  url         text not null,
  outcome     text not null check (outcome in ('inserted','duplicate','failed','quality_gate')),
  extractor   text,
  error       text,
  created_at  timestamptz not null default now()
);
