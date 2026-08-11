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

insert into commitment(org_id,conversation_id,client_id,text,owner,deadline,type,confidence,source_span,status) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1',
  'Send Mia a revised algebra practice set','owner@demo.test', now()+interval '2 days','deliverable','high','revised algebra practice set by Friday','proposed'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000c1',
  'Email parents a progress note',null, now()-interval '1 day','email','medium','email the parents a progress note','proposed'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000c2',
  'Deliver audit findings deck','member@demo.test', now()+interval '5 days','deliverable','high','audit findings deck next Wednesday','proposed'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000c3',
  'Send accountability worksheet','owner@demo.test', now()-interval '2 days','email','low','accountability worksheet today','proposed');
