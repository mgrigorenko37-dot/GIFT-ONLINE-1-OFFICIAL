const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

if (!code.includes('simulateSales(io)')) {
  code = `import { simulateSales } from "./server/mockMinter";\n` + code;
  code = code.replace("io.on('connection', (socket) => {", "simulateSales(io);\n  io.on('connection', (socket) => {");
  fs.writeFileSync('server.ts', code);
}
console.log("Hooked mock minter");
