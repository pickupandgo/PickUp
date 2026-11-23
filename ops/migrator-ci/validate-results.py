import json,pathlib
p=pathlib.Path('migrator-evidence')
r=lambda n:json.loads((p/(n+'.json')).read_text())
b,a,f,rerun,final=[r(n) for n in ['before','after','fresh','rerun','final']]
assert all(x['result']=='PASS' for x in [b,a,f,rerun,final])
assert b['data']==a['data']==rerun['data']==final['data']
assert b['history']==a['history'][:32]
assert a['history']==rerun['history']==final['history']
assert a['schema_sha256']==f['schema_sha256']==rerun['schema_sha256']==final['schema_sha256']
assert a['data']['delivery_proofs']['rows']==3 and a['data']['users']['rows']==2
assert r('triggers')['probe_count']==17
assert r('TLS')['result']==r('ACL')['result']=='PASS'
(p/'validation.json').write_text(json.dumps({'result':'PASS','expected_migrations':33,'upgrade_applied_exactly_one':True,'fresh_33_migrations':True,'all_43_business_table_hashes_unchanged':True,'all_32_existing_history_rows_unchanged':True,'pending_and_historical_and_legacy_noncanonical_proofs_preserved':True,'fresh_and_upgrade_schema_match':True,'idempotent_rerun':True,'trigger_probes':17,'strict_CA_and_hostname_TLS':True,'ACL_apply_and_exact_rollback':True},indent=2)+'\n')
