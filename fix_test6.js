const fs = require('fs');
let code = fs.readFileSync('tests/negative_balance.test.ts', 'utf8');

code = code.replace(
  "const insertExecCall = client.query.mock.calls.find(c => c[0].includes('INSERT INTO te_executions') && c[0].includes('REJECTED'));",
  "const insertExecCall = client.query.mock.calls.find(c => c[0].includes('INSERT INTO te_executions') && c[1].includes('REJECTED'));"
);

fs.writeFileSync('tests/negative_balance.test.ts', code);
