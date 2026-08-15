const fs = require('fs');
let code = fs.readFileSync('tests/negative_balance.test.ts', 'utf8');

code = code.replace(
  "if (queryStr.startsWith('INSERT INTO te_executions')) {\n        return { rowCount: 1 };\n      }",
  "if (queryStr.startsWith('INSERT INTO te_executions')) {\n        return { rowCount: 1 };\n      }\n      if (queryStr.startsWith('INSERT INTO te_positions') || queryStr.startsWith('UPDATE te_positions')) {\n        return { rowCount: 1 };\n      }"
);

fs.writeFileSync('tests/negative_balance.test.ts', code);
