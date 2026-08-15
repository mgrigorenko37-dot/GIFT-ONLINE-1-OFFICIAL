const fs = require('fs');
let code = fs.readFileSync('tests/negative_balance.test.ts', 'utf8');

code = code.replace(
  "client.query.mockImplementation(async (queryStr: string, params: any[]) => {",
  "client.query.mockImplementation(async (queryStr: string, params: any[]) => {\n      console.log('QUERY:', queryStr);"
);

fs.writeFileSync('tests/negative_balance.test.ts', code);
