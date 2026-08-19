const fs = require('fs');

let serverCode = fs.readFileSync('server.ts', 'utf8');
serverCode = serverCode.replace("import express from 'express';", "import express from 'express';\nimport { errorLogger } from './server/errorLogger';");
serverCode = serverCode.replace("app.use('/api', (req, res, next)", "app.use(errorLogger);\n  app.use('/api', (req, res, next)");
fs.writeFileSync('server.ts', serverCode, 'utf8');

let indexCode = fs.readFileSync('index.html', 'utf8');
const script = `
<script>
  window.addEventListener('error', function(e) {
    fetch('/api/log-client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: e.message, filename: e.filename, lineno: e.lineno, error: e.error?.stack || e.error }) });
  });
  window.addEventListener('unhandledrejection', function(e) {
    fetch('/api/log-client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: e.reason?.message || 'unhandledrejection', error: e.reason?.stack || e.reason }) });
  });
</script>
`;
indexCode = indexCode.replace('<head>', '<head>' + script);
fs.writeFileSync('index.html', indexCode, 'utf8');
