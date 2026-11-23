#!/usr/bin/env sh
# Hold only this disposable container so tmpfs results can be copied BEFORE stop.
# No test failure is hidden: the host checks the exact saved exit status.
set +e
mode=$1
if [ "$mode" = unit ]; then
 node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false
 code=$?
 if [ "$code" = 0 ]; then
  node node_modules/jest/bin/jest.js --runInBand --json --outputFile=/tmp/unit.json
  code=$?
 fi
elif [ "$mode" = suite ]; then
 node node_modules/jest/bin/jest.js --config test/jest-e2e.json --globalSetup /ci/suite-setup.cjs --runInBand --json --outputFile=/tmp/suite.json
 code=$?
else
 code=90
fi
printf '%s\n' "$code" > /tmp/test-exit-code
sleep 1200
exit "$code"
