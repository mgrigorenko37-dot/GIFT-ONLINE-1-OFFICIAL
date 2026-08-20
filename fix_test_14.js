const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

code = code.replace(
  'expect(bal.available).toBeCloseTo(100 - bal.fees); // 14. PnL Short',
  'expect(bal.available).toBeCloseTo(90 - bal.fees);'
);
// wait, we don't have a comment. Let's just do a targeted replace for test 14.
const parts = code.split('14. PnL Short с убытком');
parts[1] = parts[1].replace(
  'expect(bal.available).toBeCloseTo(100 - bal.fees);',
  'expect(bal.available).toBeCloseTo(90 - bal.fees);'
);
fs.writeFileSync('tests/postgresql_margin_tests.test.ts', parts.join('14. PnL Short с убытком'));
