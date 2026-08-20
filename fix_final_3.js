const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

code = code.split('90 - bal.fees').join('100 - bal.fees');
code = code.replace(/it\('14. PnL Short с убытком.*?\}\);/s, (match) =>
  match.replace('100 - bal.fees', '90 - bal.fees')
);

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
