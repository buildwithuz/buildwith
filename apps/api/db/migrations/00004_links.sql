-- +goose Up

create table links (
  id            bigint generated always as identity primary key,
  author_id     bigint      not null references users (id) on delete restrict,
  kind          text        not null check (kind in ('link','text','ask','show')),
  title         text        not null check (char_length(title) between 3 and 100),
  slug          text        not null default '',
  url           text        check (char_length(url) <= 2000),
  url_canonical text        check (char_length(url_canonical) <= 2000),
  url_hash      bytea,
  domain        text        not null default '' check (char_length(domain) <= 253),
  body_md       text        not null default '' check (char_length(body_md) <= 20000),
  body_html     text        not null default '',
  points        integer     not null default 1,
  comment_count integer     not null default 0,
  flag_count    integer     not null default 0,
  score         double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted_at    timestamptz,
  killed_at     timestamptz,
  search        tsvector    generated always as (
                  to_tsvector('simple', title || ' ' || coalesce(domain,'') || ' ' || body_md)
                ) stored,
  constraint links_url_required check ((kind = 'link') = (url is not null)),
  constraint links_show_url check (kind <> 'show' or url is not null or char_length(body_md) > 0)
);

create index links_created_at_idx on links (created_at desc, id desc)
  where deleted_at is null and killed_at is null;
create index links_score_idx on links (score desc, id desc)
  where deleted_at is null and killed_at is null;
create index links_points_idx on links (points desc, id desc)
  where deleted_at is null and killed_at is null;
create index links_author_id_idx on links (author_id, created_at desc);
create index links_kind_created_at_idx on links (kind, created_at desc, id desc)
  where deleted_at is null and killed_at is null;
create index links_domain_idx on links (domain, created_at desc) where deleted_at is null;
create index links_url_hash_idx on links (url_hash, created_at desc) where url_hash is not null and deleted_at is null;
create index links_search_idx on links using gin (search);

create table link_tags (
  link_id bigint not null references links (id) on delete cascade,
  tag_id  bigint not null references tags (id) on delete cascade,
  primary key (link_id, tag_id)
);

create index link_tags_tag_id_idx on link_tags (tag_id, link_id desc);

create table domain_rules (
  domain     text        primary key check (char_length(domain) <= 253),
  multiplier double precision not null default 1 check (multiplier between 0 and 2),
  banned     boolean     not null default false,
  note       text        not null default '',
  created_at timestamptz not null default now()
);

-- +goose Down
drop table domain_rules;
drop table link_tags;
drop table links;
