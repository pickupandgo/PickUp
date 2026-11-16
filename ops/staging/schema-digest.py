import hashlib,pathlib
root=pathlib.Path('prisma/migrations');h=hashlib.sha256()
for p in sorted(root.rglob('migration.sql')):
 h.update(p.relative_to(root).as_posix().encode()+b'\0'+p.read_bytes())
print(h.hexdigest())
