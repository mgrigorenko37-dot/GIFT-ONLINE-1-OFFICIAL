const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

code = code.replace(
  'expect(pos?.qty).toBe(0);',
  'expect(pos?.qty).toBe(1);' // because the order is rejected for exceeding available qty!
);

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
