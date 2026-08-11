-- Auth users mirror app_user so a real session can exist locally (no passwords:
-- sessions are minted with the admin API in dev, Google OAuth from Phase 3).
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','owner@demo.test',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','member@demo.test',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()),
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','user@other.test',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now());

-- GoTrue scans these token columns into non-nullable strings; NULL breaks user lookup.
update auth.users set confirmation_token = '', recovery_token = '',
  email_change_token_new = '', email_change_token_current = '', email_change = '',
  phone_change = '', phone_change_token = '', reauthentication_token = ''
where email in ('owner@demo.test','member@demo.test','user@other.test');

insert into auth.identities (id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u;

insert into organization(id,name) values
 ('00000000-0000-0000-0000-00000000000a','Demo Studio'),
 ('00000000-0000-0000-0000-00000000000b','Other Co');
insert into app_user(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','owner@demo.test'),
 ('00000000-0000-0000-0000-0000000000a2','member@demo.test'),
 ('00000000-0000-0000-0000-0000000000b1','user@other.test');
insert into membership(org_id,user_id,role) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a1','owner'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a2','member'),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000b1','owner');

insert into client_contact(id,org_id,name,kind) values
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','Ramirez family (tutoring)','tutoring'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-00000000000a','Northwind Ltd (consulting)','consulting'),
 ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-00000000000a','J. Okafor (coaching)','coaching'),
 ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-00000000000a','Bloom Cafe (agency)','agency');

insert into conversation(id,org_id,client_id,title) values
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','Weekly tutoring check-in'),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c2','Northwind kickoff'),
 ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c3','Coaching session 4'),
 ('00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c4','Bloom Cafe campaign review');

insert into transcript(org_id,conversation_id,body) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1',
  'Tutor: I''ll send Mia a revised algebra practice set by Friday and email the parents a progress note.'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e2',
  'Consultant: We''ll deliver the audit findings deck next Wednesday and share the data request list tomorrow.'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e3',
  'Coach: You''ll try the morning routine; I''ll send the accountability worksheet today.'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e4',
  'Lead: We''ll send three ad concepts by end of week and set up the reporting dashboard.');

insert into commitment(id,org_id,conversation_id,client_id,text,owner,deadline,type,confidence,source_span,status) values
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1',
  'Send Mia a revised algebra practice set','owner@demo.test', now()+interval '2 days','deliverable','high','revised algebra practice set by Friday','proposed'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1',
  'Email parents a progress note',null, now()-interval '1 day','email','medium','email the parents a progress note','proposed'),
 ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000c2',
  'Deliver audit findings deck','member@demo.test', now()+interval '5 days','deliverable','high','audit findings deck next Wednesday','proposed'),
 ('00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000c3',
  'Send accountability worksheet','owner@demo.test', now()-interval '2 days','email','low','accountability worksheet today','proposed');

-- Drafts are DB rows only. Nothing in this codebase can send them.
insert into deliverable_draft(org_id,commitment_id,kind,subject,body) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000f1','email',
  'Mia''s revised algebra practice set',
  'Hi Ramirez family,' || chr(10) || chr(10) ||
  'Following up on our check-in: I''m putting together a revised algebra practice set for Mia, focused on the factoring problems she found tricky. I''ll have it over to you by Friday.' || chr(10) || chr(10) ||
  'Best,' || chr(10) || 'Demo Studio'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000f2','email',
  'Mia''s progress note',
  'Hi Ramirez family,' || chr(10) || chr(10) ||
  'A short progress note from this week''s session. Mia is steady on linear equations and gaining confidence with word problems; factoring is the current focus.' || chr(10) || chr(10) ||
  'Best,' || chr(10) || 'Demo Studio'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000f3','recap',
  'Northwind kickoff recap',
  'Recap of the Northwind kickoff:' || chr(10) ||
  '- Audit findings deck due next Wednesday.' || chr(10) ||
  '- Data request list to follow tomorrow.');
