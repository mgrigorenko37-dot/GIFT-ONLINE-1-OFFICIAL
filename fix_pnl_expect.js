const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

code = code.replace(/expect\(bal\.pnl\)\.toBeCloseTo\(\s*(10|-10|-5|5)\s*-\s*bal\.fees\);/g, "expect(bal.pnl).toBeCloseTo($1);");
code = code.replace(/expect\(bal\.pnl\)\.toBeCloseTo\(10 - bal.fees\);/g, "expect(bal.pnl).toBeCloseTo(10);");

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
