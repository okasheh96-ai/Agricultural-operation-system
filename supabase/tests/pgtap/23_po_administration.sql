begin;
select no_plan();
select tests.create_user('admin_owner') as owner_id, tests.create_user('line_operator') as staff_id \gset
select tests.grant_role(:'owner_id', 'ph_own');
select tests.grant_role(:'staff_id', 'ph_ll');
select tests.farm() as farm, gen_random_uuid() as other_farm \gset
select tests.login(:'owner_id');

select public.ph_save_department(:'farm', null, null, 'test_department', 'قسم اختبار', 'Test department', 'service') as dep \gset
select is((select name_en from public.departments where id = :'dep'), 'Test department', 'Owner creates a department');
select version as version_before from public.departments where id = :'dep' \gset
select public.ph_save_department(:'farm', :'dep', :version_before, 'test_department','قسم جديد','Renamed','coordination');
select is((select name_en from public.departments where id = :'dep'), 'Renamed', 'Owner edits same record');
select throws_ok(format('select public.ph_save_department(%L,%L,%s,%L,%L,%L,%L)', :'farm', :'dep', :version_before,
  'test_department','تعديل','Conflict','service'), 'P0409', null, 'Concurrent department edit cannot overwrite a newer version');
select throws_ok(format('select public.ph_save_department(%L,null,null,%L,%L,null,%L)', :'other_farm','D','قسم','service'),
  'P0403', null, 'Owner cannot configure another farm');
select throws_ok(format('select public.ph_save_department(%L,id,version,code,name_ar,name_en,%L) from public.departments where code=%L',
  :'farm','production','qa'), 'P0422', null, 'QA structure protected');

select version as policy_before from public.settings where farm_id = :'farm' and key = 'po_lockout_minutes' \gset
select public.ph_set_account_policy(:'farm','po_lockout_minutes',25,:policy_before);
select is((select value from public.settings where farm_id = :'farm' and key='po_lockout_minutes'),'25'::jsonb,'Approved policy value persisted');
select throws_ok(format('select public.ph_set_account_policy(%L,%L,2,%s)',:'farm','po_lockout_minutes',:policy_before),
  'P0409',null,'Policy update rejects stale versions');
select throws_ok(format('select public.ph_set_account_policy(%L,%L,0,1)',:'farm','po_lockout_attempts'),
  'P0422',null,'Lockout cannot be disabled');

select '[{"code":"CAT_TEST","name_ar":"اختبار","kind":"manual"},{"code":"CAT_TEST_2","name_ar":"اختبار 2","kind":"washer"}]' as batch \gset
select is((public.ph_import_master(:'farm','ph_lines',:'batch',false)->'issues'),'[]'::jsonb,'Line import preview valid');
select is((select count(*) from public.ph_lines where code like 'CAT_TEST%'),0::bigint,'Preview leaves no master rows');
select is((public.ph_import_master(:'farm','ph_lines',:'batch',true)->>'saved')::int,2,'Commit imports both lines');
select is((select count(*) from public.ph_lines where code like 'CAT_TEST%' and verification_status <> 'verified'),2::bigint,'Imported lines require approval');
select is((public.ph_import_master(:'farm','ph_lines',:'batch',true)->>'saved')::int,0,'Repeated import adds no rows');
select is(public.ph_import_master(:'farm','ph_lines','[{"code":"CAT_FRESH","name_ar":"ا","kind":"washer"},{"code":"CAT_TEST","name_ar":"ا","kind":"washer"}]',true)->'issues',
  '[{"row":2,"reason":"duplicate"}]'::jsonb,'Duplicate identifies exact input record');
select ok(not exists(select 1 from public.ph_lines where code='CAT_FRESH'),'A duplicate rolls back all rows in the batch');
select is(public.ph_import_master(:'farm','ph_lines','[{"code":"CAT_MISSING","name_ar":"ا"}]',false)->'issues',
  '[{"row":1,"reason":"invalid"}]'::jsonb,'Missing type goes into the review list');
select throws_ok(format('select public.ph_import_master(%L,%L,%L,true)', :'farm','departments',:'batch'),'P0422',null,'Only supported masters can be imported');

select tests.logout();
select tests.login(:'staff_id');
select throws_ok(format('select public.ph_save_department(%L,null,null,%L,%L,null,%L)',:'farm','test_denied','قسم','service'),
 'P0403',null,'Line worker cannot administer departments');
select throws_ok(format('select public.ph_import_master(%L,%L,%L,true)',:'farm','ph_lines',:'batch'),'P0403',null,'Line worker cannot import master data');
select throws_ok(format('select public.ph_set_account_policy(%L,%L,5,1)',:'farm','po_lockout_minutes'),'P0403',null,'Line worker cannot change account policy');
select * from finish();
rollback;
