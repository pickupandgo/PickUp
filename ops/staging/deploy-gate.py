#!/usr/bin/python3
"""Root-owned forced-command handler; accepts only staging image load/deploy or pinned rollback."""
import sys,pathlib,subprocess,hashlib,json,re,tempfile,fcntl,os,urllib.request,time
ROOT=pathlib.Path('/home/ubuntu/multipleride-staging')
def run(args,**kw):return subprocess.run(args,check=True,capture_output=True,**kw).stdout
def deploy():run(['/usr/bin/python3',str(ROOT/'deploy-current.py')])
def pins():return dict(line.split('=',1) for line in (ROOT/'.env').read_text().splitlines())
def setpin(image):
 p=pins();p['API_IMAGE']=image
 tmp=ROOT/'.env.next';tmp.write_text(''.join(f'{k}={v}\n' for k,v in p.items()));tmp.chmod(0o600);tmp.replace(ROOT/'.env')
def check():
 for attempt in range(10):
  try:
   with urllib.request.urlopen('http://127.0.0.1:13000/health/ready',timeout=3) as r:assert r.status==200
   print('staging health: ok');return
  except Exception:
   if attempt==9:raise
   time.sleep(1)
assert os.geteuid()==0
args=sys.argv[1:]
assert args and args[0] in ['check','deploy','rollback'],'Unsupported staging command'
with open('/run/lock/mr-staging-ci.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 if args==['check']:check();raise SystemExit(0)
 if args==['rollback']:
  image=(ROOT/'ci-previous-image').read_text().strip();assert re.fullmatch(r'sha256:[a-f0-9]{64}',image)
  setpin(image);deploy();check();print('staging image rollback complete; database preserved');raise SystemExit(0)
 assert len(args)==3 and args[0]=='deploy'
 commit,digest=args[1:];assert re.fullmatch('[a-f0-9]{40}',commit) and re.fullmatch('[a-f0-9]{64}',digest)
 image=None
 with tempfile.TemporaryDirectory(prefix='mr-stage-ci-',dir='/var/tmp') as tmp:
  archive=pathlib.Path(tmp)/'image.tar.gz';h=hashlib.sha256();size=0
  with archive.open('wb') as out:
   while chunk:=sys.stdin.buffer.read(1024*1024):
    size+=len(chunk);assert size<=800*1024*1024,'Artifact size limit exceeded';h.update(chunk);out.write(chunk)
  assert h.hexdigest()==digest,'Artifact digest mismatch'
  run(['/usr/bin/docker','load','--input',str(archive)])
  meta=json.loads(run(['/usr/bin/docker','image','inspect','multipleride-staging:'+commit]))[0]
  cfg=meta['Config'];labels=cfg.get('Labels') or {}
  assert labels.get('org.opencontainers.image.revision')==commit
  assert labels.get('org.opencontainers.image.source')=='https://github.com/pickupandgo/PickUp'
  assert labels.get('io.multipleride.schema-sha256')==(ROOT/'schema-sha256.txt').read_text().strip(),'Schema change requires a separate migration review'
  assert cfg['User']=='node' and cfg['Cmd']==['node','dist/main.js']
  assert not cfg.get('Volumes') and not cfg.get('Entrypoint')
  image=meta['Id'];old=pins()['API_IMAGE']
  (ROOT/'ci-previous-image').write_text(old+'\n');(ROOT/'ci-previous-image').chmod(0o600)
  # Snapshot staging only, before deploying. Never touches the original or Render database.
  dump=run(['/usr/bin/docker','exec','multipleride-staging-db','pg_dump','-U','mr_staging_owner','-d','multipleride_test','-Fc','--no-owner','--no-acl'])
  backup=ROOT/'ci-predeploy.dump';backup.write_bytes(dump);backup.chmod(0o600)
  setpin(image)
  try:deploy();check()
  except Exception:
   setpin(old);deploy();raise
  (ROOT/'ci-last-release.json').write_text(json.dumps({'commit':commit,'image':image,'artifact_sha256':digest,'previous_image':old,'database_migrations':'none'},indent=2))
  print('staging pinned-image deployment healthy; rollback image retained')
