"""Disposable GitHub-hosted joint test, generated dummy configuration only."""
import datetime,json,os,pathlib,secrets,subprocess,sys,re
assert os.environ.get('GITHUB_ACTIONS')=='true'
assert os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted'
assert os.environ.get('GITHUB_REPOSITORY')=='pickupandgo/PickUp'
assert os.environ.get('GITHUB_REF')=='refs/heads/mr-joint-synthetic-ci-20261123'
prefix='mr-joint-'+os.environ['GITHUB_RUN_ID']+'-'+os.environ['GITHUB_RUN_ATTEMPT']
state=pathlib.Path(os.environ['RUNNER_TEMP'])/prefix
out=pathlib.Path('joint-evidence');out.mkdir(exist_ok=True)
mode=sys.argv[1]
if mode=='init':
 assert not state.exists();state.mkdir(mode=0o700)
 values={k:'dummy_engine_ci_'+secrets.token_hex(24) for k in ['owner','backend','engine','key','razorpay','webhook']}
 (state/'dummy.json').write_text(json.dumps(values))
 for v in values.values():print('::add-mask::'+v)
 def save(n,d):
  p=state/n;p.write_text(''.join(f'{k}={v}\n' for k,v in d.items()));p.chmod(0o600)
 policy={'MANUAL_KYC_POLICY_VERSION':'CONTRACT_E2E_POLICY_V1','MANUAL_KYC_REQUIRED_DOCUMENTS':'IDENTITY,LICENSE','MANUAL_KYC_CHECKLIST':'FACE_MATCH,NAME_MATCH','VEHICLE_REQUIRED_DOCUMENTS':'RC,INSURANCE'}
 save('db.env',{'POSTGRES_USER':'ci_owner','POSTGRES_PASSWORD':values['owner'],'POSTGRES_DB':'mr_joint_backend_e2e'})
 save('gateway.env',{'CI_INTERNAL_KEY':values['key']})
 base={'NODE_EXTRA_CA_CERTS':'/ci-ca.pem','NODE_OPTIONS':'--max-old-space-size=256','DATABASE_POOL_MAX':'3','AUTH_ISSUER':'https://engine-ci.invalid','AUTH_AUDIENCE':'mr-engine-ci','PORT':'3000'}
 save('engine.env',{**base,'NODE_ENV':'production','MR_SYNTHETIC_ONLY':'true',
  'DATABASE_URL':f"postgresql://engine_ci_runtime:{values['engine']}@172.29.63.2:5432/mr_engine_synthetic_test",
  'AUTH_JWKS_URL':'https://127.0.0.1:3443/jwks','PAYMENT_BACKEND_URL':'https://127.0.0.1:3443',
  'PAYMENT_BACKEND_INTERNAL_API_KEY':values['key'],'PAYMENT_BACKEND_TIMEOUT_MS':'1000',
  'OUTBOX_POLL_INTERVAL_MS':'0','DISPATCH_POLL_INTERVAL_MS':'0'})
 backend={**base,**policy,'NODE_ENV':'test','LOG_LEVEL':'warn',
  'DATABASE_URL':f"postgresql://mr_app:{values['backend']}@172.29.63.2:5432/mr_joint_backend_e2e",
  'AUTH_PROVIDER':'firebase','AUTH_JWKS_URL':'https://172.29.63.3:3443/jwks','INTERNAL_API_KEYS':values['key'],
  'RAZORPAY_KEY_ID':'rzp_test_SYNTHETICONLY','RAZORPAY_KEY_SECRET':values['razorpay'],
  'RAZORPAY_WEBHOOK_SECRET':values['webhook'],'RAZORPAY_API_BASE_URL':'http://127.0.0.1:9',
  'WALLET_TOPUP_MAX_PAISE':'100','ADMIN_ADJUSTMENT_MAX_PAISE':'500000','TDS_ENABLED':'false',
  'MR_DISABLE_CHAT_CLEANUP':'true','FCM_ENABLED':'false','SETTLEMENT_PROVIDER':'disabled','SETTLEMENT_SYNC_INTERVAL_MINUTES':'0',
  'PAYOUT_PROVIDER':'disabled','PAYOUT_SCHEDULE_ENABLED':'false','PAYOUT_AUTO_EXECUTE':'false',
  'REFUND_PROVIDER':'disabled','REFUND_AUTO_ON_CANCEL':'false','COLLECTION_LINK_PROVIDER':'disabled',
  'DOCUMENT_STORAGE_PROVIDER':'disabled','DOCUMENT_SCANNER_PROVIDER':'disabled','MANUAL_KYC_ENABLED':'false','SWAGGER_ENABLED':'false'}
 save('backend.env',backend)
 save('seed.env',{**policy,'NODE_ENV':'test','CONTRACT_E2E_FIXTURE':'true',
  'DATABASE_URL':f"postgresql://ci_owner:{values['owner']}@172.29.63.2:5432/mr_joint_backend_e2e"})
 sql=f"""CREATE ROLE mr_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD '{values['backend']}';
CREATE ROLE engine_ci_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD '{values['engine']}';
GRANT CONNECT ON DATABASE mr_joint_backend_e2e TO ci_owner,mr_app;
GRANT CONNECT ON DATABASE mr_engine_synthetic_test TO ci_owner,engine_ci_runtime;
REVOKE ALL ON DATABASE mr_joint_backend_e2e,mr_engine_synthetic_test FROM PUBLIC;
REVOKE CONNECT,TEMPORARY ON DATABASE postgres,template1 FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mr_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
"""
 (state/'roles.sql').write_text(sql)
elif mode=='sanitize':
 t=sys.stdin.read()[-65536:]
 if (state/'dummy.json').exists():
  for v in json.loads((state/'dummy.json').read_text()).values():t=t.replace(v,'[DUMMY REDACTED]')
 t=re.sub(r'postgres(?:ql)?://[^\s"\']+','[SYNTHETIC URI REDACTED]',t)
 t=re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[SYNTHETIC JWT REDACTED]',t)
 print(t,end='')
elif mode=='safety':
 def inspect(s):return json.loads(subprocess.check_output(['docker','inspect',prefix+'-'+s],text=True))[0]
 n=json.loads(subprocess.check_output(['docker','network','inspect',prefix+'-net'],text=True))[0]
 assert n['Internal'] and not n['EnableIPv6']
 for s in ['backend','engine','core','backguard','db','gateway']:
  c=inspect(s);h=c['HostConfig']
  assert h['ReadonlyRootfs'] and not h['Privileged'] and not h['PortBindings']
  assert h['Memory']>0 and h['MemorySwap']==h['Memory'] and h['NanoCpus']>0 and h['PidsLimit']>0
  assert 'ALL' in h['CapDrop'] and any('no-new-privileges' in x for x in h['SecurityOpt'])
  assert not any('/var/run/docker.sock'==m['Source'] for m in c.get('Mounts',[]))
 for s,g in [('backend','backguard'),('engine','core')]:
  c=inspect(s);guard=inspect(g)
  assert c['Config']['User']=='node' and c['Config']['Cmd']==['node','dist/main.js']
  assert c['HostConfig']['NetworkMode'] in ['container:'+guard['Id'],'container:'+guard['Name'].lstrip('/')]
 (out/'safety.json').write_text(json.dumps({'result':'PASS','internal_network':True,'IPv6_disabled':True,'published_ports':False,'runtime_nonroot':True,'readonly_rootfs':True,'resource_limits':True,'namespace_firewalls':True,'default_image_commands':True,'cloud_or_production_credentials':False},indent=2)+'\n')
elif mode=='summary':
 def read(n):
  try:return json.loads((out/n).read_text())
  except (FileNotFoundError,json.JSONDecodeError):return None
 phase=(out/'phase.txt').read_text().strip() if (out/'phase.txt').exists() else 'not-started'
 result={'result':'PASS' if phase=='all-tests-passed' and read('cleanup.json')['result']=='PASS' else 'FAIL',
  'workflow_sha':os.environ['GITHUB_SHA'],'run_url':f"https://github.com/pickupandgo/PickUp/actions/runs/{os.environ['GITHUB_RUN_ID']}",
  'recorded_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'last_phase':phase,
  'image_rebuild':False,'AWS_Render_contact':False,'production_credentials_or_data':False,
  'background_workers_enabled':False,'live_financial_providers':False,'synthetic_cash_and_wallet_records_only':True}
 for n in ['images','safety','network-core','network-backguard','configuration-backend','configuration-engine','seed','baseline','business','faults','after-backend-restart','after-engine-restart','background','cleanup']:
  result[n]=read(n+'.json')
 (out/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(result,indent=2))
 with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:f.write('\nJoint immutable Backend + Engine: '+result['result']+'\n')
else:raise SystemExit('Unknown mode')
