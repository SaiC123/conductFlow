-- Multi-user orgs, part three. `task.owner` has been text since 0001, copied verbatim from
-- `commitment.owner`, which is whatever the transcript called the person: "Tutor", "Ana", "me".
-- That string is worth keeping — it is the evidence, it is what the extraction actually saw,
-- and the operations map counts on it — but it is not somebody the product can do anything
-- with. It cannot be assigned to, it cannot be filtered by a real person, and two spellings of
-- one human are two owners.
--
-- So the column is renamed to what it always was, and a real reference is added beside it.
-- Existing rows keep their text and get a null reference on purpose: guessing which app_user
-- "Tutor" meant would quietly hand one person's promise to another, and in a product whose
-- whole subject is who owes what to whom, a wrong assignment is worse than an absent one.

alter table task rename column owner to owner_name;
alter table task add column owner_user_id uuid references app_user(id);

-- The board's one new query: what is assigned to this person in this organization.
create index task_owner_user on task (org_id, owner_user_id);

/*
 * An assignee has to be a member of the task's own organization.
 *
 * This is the cross-tenant edge of the feature. `authenticated` already holds update on task
 * and the RLS policy scopes that to the caller's organizations, so the row is safe — but
 * nothing stopped the *value* naming a stranger, and a task assigned to somebody outside the
 * org would put that person's name and address on a screen they have no relationship with. A
 * foreign key cannot express it, because the constraint is about two tables at once.
 */
create or replace function task_owner_is_a_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_user_id is null then return new; end if;
  if not exists (select 1 from membership
    where org_id = new.org_id and user_id = new.owner_user_id)
  then
    raise exception 'a task can only be assigned to a member of its organization'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger task_owner_is_a_member_trigger
  before insert or update on task
  for each row execute function task_owner_is_a_member();

/*
 * The same invariant, kept true over time rather than only at the moment of writing.
 *
 * Removing somebody from an organization has to take their name off the work as well. Left
 * alone, an assignment to a person who no longer has access reads on the board as though
 * somebody is dealing with it, which is precisely the failure the board exists to prevent —
 * and it would leave the trigger above stating something about the table that had stopped
 * being true.
 */
create or replace function unassign_tasks_of_removed_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update task set owner_user_id = null
    where org_id = old.org_id and owner_user_id = old.user_id;
  return old;
end;
$$;

create trigger unassign_tasks_of_removed_member_trigger
  after delete on membership
  for each row execute function unassign_tasks_of_removed_member();
