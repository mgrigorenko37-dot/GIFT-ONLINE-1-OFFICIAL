const fs = require('fs');

const files = ['server/marketRepository.ts', 'server/tradingOutboxWorker.ts'];

for (const file of files) {
  let code = fs.readFileSync(file, 'utf8');

  // We want to replace `await client.query('ROLLBACK');` with `try { await client.query('ROLLBACK'); } catch (e) {}`
  // But be careful about single line blocks or indentation.
  code = code.replace(
    /await client\.query\('ROLLBACK'\);/g,
    "try { await client.query('ROLLBACK'); } catch(e) {}"
  );

  fs.writeFileSync(file, code, 'utf8');
}
