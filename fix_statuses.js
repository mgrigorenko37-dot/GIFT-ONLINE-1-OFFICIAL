const fs = require('fs');

let content = fs.readFileSync('server/tradingEngine.ts', 'utf8');

// fix updateMarkPrice
content = content.replace(/newStatus = 'MARGIN_CALL';/g, "newStatus = 'MarginCall';");
content = content.replace(/newStatus = 'OPEN';/g, "newStatus = 'Open';");
content = content.replace(/'Open', 'OPEN', 'MarginCall', 'MARGIN_CALL'/g, "'Open', 'MarginCall'");

// fix liquidateUser
content = content.replace(/pos\.status = 'LIQUIDATED' as any;/g, "pos.status = 'Liquidated';");
content = content.replace(
  /UPDATE te_positions SET status = 'LIQUIDATED'/g,
  "UPDATE te_positions SET status = 'Liquidated'"
);

fs.writeFileSync('server/tradingEngine.ts', content);

let testContent = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');
testContent = testContent.replace(/'LIQUIDATED'/g, "'Liquidated'");
fs.writeFileSync('tests/postgresql_margin_tests.test.ts', testContent);

console.log('statuses fixed');
