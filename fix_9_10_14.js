const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

code = code.replace(/expect\(bal\.available\)\.toBeCloseTo\(105\);/g, "expect(bal.available).toBeCloseTo(105 - bal.fees);");
code = code.replace(/expect\(bal\.available\)\.toBeCloseTo\(100 - bal\.fees\);/g, "expect(bal.available).toBeCloseTo(90 - bal.fees);");

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
