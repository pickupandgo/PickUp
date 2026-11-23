import pathlib,re,sys
t=sys.stdin.read()[-100000:]
p=pathlib.Path(sys.argv[1])
if p.exists():t=t.replace(p.read_text(),'[DUMMY REDACTED]')
t=re.sub(r'postgres(?:ql)?://[^\s"\']+','[DATABASE URI REDACTED]',t)
print(t,end='')
