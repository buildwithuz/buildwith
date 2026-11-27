-- +goose Up

create table series (
  id          bigint generated always as identity primary key,
  author_id   bigint      not null references users (id) on delete cascade,
  slug        text        not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title       text        not null check (char_length(title) between 3 and 120),
  description text        not null default '' check (char_length(description) <= 400),
  created_at  timestamptz not null default now()
);

create unique index series_author_slug_key on series (author_id, slug);

create table articles (
  id              bigint generated always as identity primary key,
  author_id       bigint      not null references users (id) on delete restrict,
  slug            text        not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  title           text        not null check (char_length(title) between 3 and 140),
  subtitle        text        not null default '' check (char_length(subtitle) <= 200),
  cover_media     bigint      references media (id) on delete set null,
  body_md         text        not null default '' check (char_length(body_md) <= 200000),
  body_html       text        not null default '',
  toc             jsonb       not null default '[]',
  lang            text        not null default 'uz' check (lang in ('uz','ru','en')),
  canonical_url   text        check (char_length(canonical_url) <= 2000),
  series_id       bigint      references series (id) on delete set null,
  series_sort     smallint    not null default 0,
  status          text        not null default 'draft' check (status in ('draft','scheduled','published')),
  published_at    timestamptz,
  scheduled_at    timestamptz,
  featured_at     timestamptz,
  reading_minutes smallint    not null default 1,
  points          integer     not null default 1,
  comment_count   integer     not null default 0,
  flag_count      integer     not null default 0,
  score           double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  killed_at       timestamptz,
  constraint articles_published_has_time check (status <> 'published' or published_at is not null),
  constraint articles_scheduled_has_time check (status <> 'scheduled' or scheduled_at is not null)
);

create unique index articles_author_slug_key on articles (author_id, slug);
create index articles_published_at_idx on articles (published_at desc, id desc)
  where status = 'published' and deleted_at is null and killed_at is null;
create index articles_score_idx on articles (score desc, id desc)
  where status = 'published' and deleted_at is null and killed_at is null;
create index articles_featured_at_idx on articles (featured_at desc, id desc) where featured_at is not null;
create index articles_author_id_idx on articles (author_id, updated_at desc);
create index articles_series_idx on articles (series_id, series_sort) where series_id is not null;
create index articles_scheduled_idx on articles (scheduled_at) where status = 'scheduled';

create table article_tags (
  article_id bigint not null references articles (id) on delete cascade,
  tag_id     bigint not null references tags (id) on delete cascade,
  primary key (article_id, tag_id)
);

create index article_tags_tag_id_idx on article_tags (tag_id, article_id desc);

create table article_versions (
  id         bigint generated always as identity primary key,
  article_id bigint      not null references articles (id) on delete cascade,
  n          integer     not null,
  title      text        not null,
  body_md    text        not null,
  created_at timestamptz not null default now()
);

create unique index article_versions_article_n_key on article_versions (article_id, n desc);

-- +goose Down
drop table article_versions;
drop table article_tags;
drop table articles;
drop table series;
