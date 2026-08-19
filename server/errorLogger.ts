import express from 'express';
import fs from 'fs';
export const errorLogger = express.Router();
errorLogger.post('/api/log-client-error', express.json(), (req, res) => {
  fs.appendFileSync('client_errors.log', JSON.stringify(req.body) + '\n');
  res.json({ ok: true });
});
