const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');
code = code.replace("if (!order) throw new Error(\"Order rejected\");", "console.log('Order status:', order.status, order.rejectionReason); if (!order) throw new Error(\"Order rejected\");");
fs.writeFileSync('tests/postgresql_margin_tests.test.ts', code);
