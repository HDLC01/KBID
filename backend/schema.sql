-- KBID Proposal Generator — Postgres schema (self-hosted on the VPS).
-- Idempotent: safe to run on every startup.

-- KBID team members (Clerk user id <-> email/role). Role is authoritative in-app.
create table if not exists users (
    id           text primary key,                 -- Clerk user id (JWT `sub`)
    email        text unique not null,
    role         text not null default 'member',   -- admin | member
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz
);

-- One row per project. The whole client-side state (intake + estimate + proposal)
-- lives in `data` jsonb, keyed by the client-generated UUID carried in ?d=<uuid>.
create table if not exists drafts (
    id          text primary key,                  -- client UUID (the ?d= value)
    data        jsonb not null default '{}'::jsonb,
    owner_email text,
    title       text,
    status      text not null default 'draft',      -- draft | generated | sent | signed
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    deleted_at  timestamptz
);
create index if not exists drafts_owner_idx on drafts (owner_email) where deleted_at is null;
create index if not exists drafts_updated_idx on drafts (updated_at desc) where deleted_at is null;

-- Audit trail (created/updated/generated/trashed/restored, etc.).
create table if not exists events (
    id          bigserial primary key,
    draft_id    text,
    actor_email text,
    kind        text not null,
    detail      text,
    at          timestamptz not null default now()
);
create index if not exists events_draft_idx on events (draft_id, at desc);
