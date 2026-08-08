const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const newSocketLogic = `
    socket.on('market_subscribe', (data) => {
      if (data.channel === 'gift_market' && data.instrumentKey) {
        const room = \`market_\${data.instrumentKey}\`;
        socket.join(room);
        console.log(\`Client \${socket.id} joined \${room}\`);
      }
    });
    
    socket.on('market_unsubscribe', (data) => {
      if (data.channel === 'gift_market' && data.instrumentKey) {
        const room = \`market_\${data.instrumentKey}\`;
        socket.leave(room);
        console.log(\`Client \${socket.id} left \${room}\`);
      }
    });
`;

if (!code.includes('market_subscribe')) {
  code = code.replace("socket.on('subscribe', (giftName) => {", newSocketLogic + "\n    socket.on('subscribe', (giftName) => {");
  fs.writeFileSync('server.ts', code);
}
console.log("Patched WS logic");
