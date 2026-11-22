"""Sanitized CI evidence only. Never read application .env or cloud credentials."""
import json, pathlib, re, sys

def sanitize(text):
    text = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----', '[TEST_KEY_REDACTED]', text, flags=re.S)
    text = re.sub(r'(postgres(?:ql)?://)[^@\s]+@', r'\1[REDACTED]@', text)
    text = re.sub(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[TEST_JWT_REDACTED]', text)
    return re.sub(r'dummy_engine_ci_[A-Za-z0-9_-]+', '[DUMMY_REDACTED]', text)

if sys.argv[1] == 'sanitize':
    print(sanitize(sys.stdin.read()), end='')
elif sys.argv[1] == 'summary':
    p = pathlib.Path('engine-evidence')
    def load(name):
        f=p/name
        return json.loads(f.read_text()) if f.exists() else None
    unit, suite = load('unit.json'), load('suite.json')
    summary={'result':'PASS' if (p/'phase.txt').read_text().strip()=='all-tests-passed' else 'FAIL',
        'phase':(p/'phase.txt').read_text().strip(),
        'unit':{k:unit.get(k) for k in ['success','numPassedTests','numFailedTests','numTotalTests','numPassedTestSuites']} if unit else None,
        'synthetic_E2E':{k:suite.get(k) for k in ['success','numPassedTests','numFailedTests','numTotalTests','numPassedTestSuites']} if suite else None,
        'configuration':load('configuration.json'),'network':load('network.json'),
        'runtime_HTTP':load('http.json'),'database':load('database.json'),
        'safety':load('safety.json'),'cleanup':load('cleanup.json'),
        'image':load('image.json'),'production_or_cloud_connections':False,'deployment':False}
    (p/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))
