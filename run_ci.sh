#!/bin/bash
run_step() {
  echo "=== $1 ==="
  $1
  local status=$?
  echo "STATUS_$2=$status" >> ci_summary.env
  if [ $status -ne 0 ]; then
    echo "Step $1 failed with status $status."
    exit $status
  fi
}
rm -f ci_summary.env
run_step "npm ci --ignore-scripts --no-audit --no-fund" "INSTALL"
run_step "npm run typecheck" "TYPECHECK"
run_step "npm run build" "BUILD"
run_step "npm run lint" "LINT"
run_step "npm run test:unit" "UNIT"
run_step "npm run test:integration" "INTEGRATION"
run_step "npm run check:security" "SECURITY"
run_step "npm run prettier" "PRETTIER"
echo "ALL_PASSED"
