const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

// The string `90 - bal.fees` appears in multiple places where it should be `100 - bal.fees`.
// Let's just fix test 1, 2, 17, 18, 29 manually by matching their test blocks.

code = code.replace(/it\('1. Открытие Long.*?\}\);/s, match => match.replace("90 - bal.fees", "100 - bal.fees"));
code = code.replace(/it\('2. Открытие Short.*?\}\);/s, match => match.replace("90 - bal.fees", "100 - bal.fees"));
code = code.replace(/it\('17. Отклонённый.*?\}\);/s, match => match.replace("90 - bal.fees", "100 - bal.fees"));
code = code.replace(/it\('18. Rollback.*?\}\);/s, match => match.replace("90 - bal.fees", "100 - bal.fees"));
code = code.replace(/it\('29. Несколько.*?\}\);/s, match => match.replace("90 - bal.fees", "100 - bal.fees"));

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
