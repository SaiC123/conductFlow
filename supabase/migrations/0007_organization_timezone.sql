-- Phase 3C follow-up: a conversation's "day" is a local day. Without this, an evening
-- conversation in a UTC+X office falls on the next UTC date and the Calendar lookup
-- summarizes the wrong day's meetings.
alter table organization
  add column timezone text not null default 'UTC';
