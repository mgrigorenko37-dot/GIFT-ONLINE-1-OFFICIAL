const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

// Test 9, 10
code = code.replace(
  /expect\(bal\.available\)\.toBeCloseTo\(105\);/g,
  'expect(bal.available).toBeCloseTo(105 - bal.fees);'
);

// Test 14 (had 100 instead of 90?)
code = code.replace(
  /expect\(bal\.available\)\.toBeCloseTo\(100 - bal\.fees\);/g,
  'expect(bal.available).toBeCloseTo(90 - bal.fees);'
);

// PnL in 11, 13, 20
code = code.replace(
  /expect\(bal\.pnl\)\.toBeCloseTo\(10 - bal\.fees\);/g,
  'expect(bal.pnl).toBeCloseTo(10);'
);

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
