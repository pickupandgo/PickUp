#!/usr/bin/python3
import os,re,shlex
args=shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND',''))
valid=args in [['check'],['rollback']] or (len(args)==3 and args[0]=='deploy' and re.fullmatch('[a-f0-9]{40}',args[1]) and re.fullmatch('[a-f0-9]{64}',args[2]))
if not valid:raise SystemExit('Only staging check, deploy and rollback commands are allowed')
os.execv('/usr/bin/sudo',['sudo','-n','/usr/local/sbin/mr-staging-deploy-gate',*args])
