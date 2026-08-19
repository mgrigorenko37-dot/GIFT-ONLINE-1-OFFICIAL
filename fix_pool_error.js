const fs = require('fs');

let code = fs.readFileSync('server/marketRepository.ts', 'utf8');

// Find all `new Pool(` and add `.on('error', (err) => console.error('pg pool error', err))`? No, the pool might be assigned to a property. Let's see.
