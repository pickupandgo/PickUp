"""GitHub runner-only, synthetic-only evidence; never imports production configuration."""
import datetime,json,os,pathlib,secrets,sys,urllib.parse

mode=sys.argv[1]
state=pathlib.Path(os.environ['RUNNER_TEMP'])/('mr-synthetic-'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['GITHUB_RUN_ATTEMPT'])
out=pathlib.Path(os.environ['GITHUB_WORKSPACE'])/'synthetic-evidence'
out.mkdir(exist_ok=True)
assert os.environ.get('GITHUB_ACTIONS')=='true'
assert os.environ.get('GITHUB_REPOSITORY')=='pickupandgo/PickUp'
assert os.environ.get('GITHUB_REF')=='refs/heads/mr-aws-rds-lab-20261121'
if mode=='init':
 assert not state.exists(),'Refusing to reuse an existing synthetic state directory'
 state.mkdir(mode=0o700);os.chmod(state,0o700)
 values={'owner':secrets.token_hex(24),'runtime':secrets.token_hex(24),
  'razorpay':secrets.token_hex(24),'webhook':secrets.token_hex(32)}
 (state/'synthetic-secrets.json').write_text(json.dumps(values));os.chmod(state/'synthetic-secrets.json',0o600)
 for value in values.values():print('::add-mask::'+value)
 db={'POSTGRES_USER':'ci_owner','POSTGRES_DB':'mr_synthetic_backend_ci','POSTGRES_PASSWORD':values['owner']}
 env={'NODE_ENV':'test','PORT':'3000','LOG_LEVEL':'warn','DATABASE_POOL_MAX':'2',
  'DATABASE_URL':'postgresql://ci_runtime:'+values['runtime']+'@172.29.62.2:5432/mr_synthetic_backend_ci',
  'AUTH_PROVIDER':'synthetic','AUTH_ISSUER':'https://synthetic-ci.invalid','AUTH_AUDIENCE':'multipleride-synthetic-ci',
  'AUTH_JWKS_URL':'http://127.0.0.1:9/jwks','RAZORPAY_KEY_ID':'rzp_test_SYNTHETICONLY',
  'RAZORPAY_KEY_SECRET':values['razorpay'],'RAZORPAY_WEBHOOK_SECRET':values['webhook'],
  'RAZORPAY_API_BASE_URL':'http://127.0.0.1:9','WALLET_TOPUP_MAX_PAISE':'100','ADMIN_ADJUSTMENT_MAX_PAISE':'1',
  'MR_DISABLE_CHAT_CLEANUP':'true','FCM_ENABLED':'false','SETTLEMENT_PROVIDER':'disabled',
  'SETTLEMENT_SYNC_INTERVAL_MINUTES':'0','PAYOUT_PROVIDER':'disabled','PAYOUT_SCHEDULE_ENABLED':'false',
  'PAYOUT_AUTO_EXECUTE':'false','REFUND_PROVIDER':'disabled','REFUND_AUTO_ON_CANCEL':'false',
  'COLLECTION_LINK_PROVIDER':'disabled','DOCUMENT_STORAGE_PROVIDER':'disabled',
  'DOCUMENT_SCANNER_PROVIDER':'disabled','MANUAL_KYC_ENABLED':'false','SWAGGER_ENABLED':'false'}
 for name,values in [('db.env',db),('api.env',env)]:
  p=state/name;p.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));p.chmod(0o600)
elif mode=='runtime-sql':
 value=json.loads((state/'synthetic-secrets.json').read_text())['runtime']
 assert len(value)==48 and all(c in '0123456789abcdef' for c in value)
 print("CREATE ROLE ci_runtime LOGIN PASSWORD '"+value+"' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;")
 print('GRANT CONNECT ON DATABASE mr_synthetic_backend_ci TO ci_runtime; GRANT USAGE ON SCHEMA public TO ci_runtime; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ci_runtime;')
 print("ALTER ROLE ci_runtime SET default_transaction_read_only=on;")
elif mode=='sanitize':
 text=sys.stdin.read()[-65536:]
 if (state/'synthetic-secrets.json').exists():
  for value in json.loads((state/'synthetic-secrets.json').read_text()).values():text=text.replace(value,'[DUMMY REDACTED]')
 import re
 text=re.sub(r'postgres(?:ql)?://[^\s\"\']+','[SYNTHETIC URI REDACTED]',text)
 print(text,end='')
elif mode=='finish':
 def read(name):
  p=out/name
  if not p.exists():return None
  try:return json.loads(p.read_text())
  except json.JSONDecodeError:return None
 result={'recorded_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'workflow_sha':os.environ['GITHUB_SHA'],'image_source_sha':'1fc2d3645f0a6412a8f11e82b2037006f57d8eff',
  'image':'ghcr.io/pickupandgo/mr-backend-rds-lab@sha256:f0514b3330d0cbb4f7f55ea62eaf6e39ca41a59c9edad2ed14b8b4bbc87ae1d4',
  'run_url':os.environ['GITHUB_SERVER_URL']+'/'+os.environ['GITHUB_REPOSITORY']+'/actions/runs/'+os.environ['GITHUB_RUN_ID'],
  'runner':'GitHub-hosted ubuntu-24.04','last_phase':(out/'phase.txt').read_text().strip() if (out/'phase.txt').exists() else 'not-started',
  'configuration':read('configuration.json'),'fail_closed':read('fail-closed-tests.json'),'network':read('network-tests.json'),'http':read('http-tests.json'),'post_idle_readiness':read('post-idle.json'),
  'database':read('database.json'),'safety':read('safety.json'),'cleanup':read('cleanup.json'),
  'production_credentials_or_data_loaded':False,'Render_or_AWS_contacted':False,'Backend_image_rebuilt':False,
  'Prisma_CLI_used':False,'migration_method':'Unmodified SQL from exact image source commit, ordered psql application with SHA256 ledger',
  'AWS_RDS_connected_API_startup_performed':False,'production_deployment_performed':False}
 result['result']='PASS' if result['last_phase']=='all-tests-passed' and result['cleanup'] and result['cleanup']['result']=='PASS' else 'FAIL'
 (out/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
 with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:
  f.write('\nSynthetic pinned Backend: '+result['result']+'\n\nImage source: '+result['image_source_sha']+'\n')
 print(json.dumps(result))
else:raise SystemExit('Unknown evidence mode')
