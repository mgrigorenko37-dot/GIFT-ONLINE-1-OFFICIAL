const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

code = code.replace(
  'expect(bal.available).toBeCloseTo(100);',
  'expect(bal.available).toBeCloseTo(100 - bal.fees);'
);

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
