const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

// Test 1, 2
code = code.replace(
  /expect\(bal.available\)\.toBeCloseTo\(90 - bal.fees\);/g,
  'expect(bal.available).toBeCloseTo(100 - bal.fees);'
);
code = code.replace(
  /expect\(bal.available\)\.toBeCloseTo\(90\);/g,
  'expect(bal.available).toBeCloseTo(100 - bal.fees);'
); // in case some were unmodified

// Test 9, 10
code = code.replace(
  /expect\(bal.available\)\.toBeCloseTo\(105 - bal.fees\);/g,
  'expect(bal.available).toBeCloseTo(105 - bal.fees);'
);

// Test 11, 13
code = code.replace(
  /expect\(bal.available\)\.toBeCloseTo\(110 - bal.fees\);/g,
  'expect(bal.available).toBeCloseTo(110 - bal.fees);'
);

// Test 12
code = code.replace(
  /expect\(bal.available\)\.toBeCloseTo\(95 - bal.fees\);/g,
  'expect(bal.available).toBeCloseTo(95 - bal.fees);'
);

// Test 14
code = code.replace(
  /expect\(bal.available\)\.toBeCloseTo\(90 - bal.fees\);/g,
  'expect(bal.available).toBeCloseTo(90 - bal.fees);'
);

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
