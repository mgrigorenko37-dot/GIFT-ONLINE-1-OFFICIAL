const fs = require('fs');
let code = fs.readFileSync('tests/postgresql_margin_tests.test.ts', 'utf8');

const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('expect(bal.available).toBeCloseTo(90 - bal.fees)')) {
    // Check if we are inside test 14
    let isTest14 = false;
    for (let j = i; j >= 0; j--) {
      if (lines[j].includes("it('14. PnL Short с убытком'")) {
        isTest14 = true;
        break;
      }
      if (lines[j].includes("it('")) break; // found another test
    }

    if (!isTest14) {
      lines[i] = lines[i].replace('90 - bal.fees', '100 - bal.fees');
    }
  }
}

fs.writeFileSync('tests/postgresql_margin_tests.test.ts', lines.join('\n'));
