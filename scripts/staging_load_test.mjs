import { spawn } from 'child_process';
import http from 'http';
import { io } from 'socket.io-client';
import crypto from 'crypto';

const PORT = 3016;
const SECRET = 'test_secret_123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runLoadTest() {
  const serverEnv = {
    ...process.env,
    PORT: PORT.toString(),
    NODE_ENV: 'loadtest',
    SIMULATION_MODE: 'true',
    NO_VITE: 'true',
    INTERNAL_API_SECRET: SECRET,
    TELEGRAM_BOT_TOKEN: '123:ABC',
  };

  const serverProcess = spawn('npx', ['tsx', 'server.ts'], { env: serverEnv });
  let serverReady = false;

  serverProcess.stdout.on('data', (data) => {
    const text = data.toString();
    if (text.includes('running on port') || text.includes('running on http')) serverReady = true;
  });

  serverProcess.stderr.on('data', (data) => {
    process.stderr.write('[STDERR] ' + data.toString());
  });

  serverProcess.on('exit', (code) => {
    console.log('Server process exited with code', code);
  });

  // Wait for server to boot
  for (let i = 0; i < 50; i++) {
    if (serverReady) break;
    await sleep(200);
  }

  if (!serverReady) {
    console.error('Server failed to start');
    serverProcess.kill();
    process.exit(1);
  }

  await sleep(1000);

  http
    .get(`http://localhost:${PORT}/api/market/stats?key=pepe_gift:::TON`, (res) => {
      console.log('GET /api/market/stats STATUS:', res.statusCode);
      res.on('data', (d) => console.log('DATA:', d.toString()));
    })
    .on('error', (e) => console.error('GET ERROR:', e.message));

  const payload = JSON.stringify({
    collection_id: 'pepe_gift',
    price: 10,
    quantity: 1,
    event_time: Date.now(),
  });
  const sig = crypto.createHmac('sha256', SECRET).update(`${Date.now()}.${payload}`).digest('hex');
  const req = http
    .request(
      `http://localhost:${PORT}/api/sales/ingest`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-timestamp': Date.now().toString(),
          'x-internal-signature': sig,
        },
      },
      (res) => {
        console.log('POST /api/sales/ingest STATUS:', res.statusCode);
        res.on('data', (d) => console.log('DATA:', d.toString()));
      }
    )
    .on('error', (e) => console.error('POST ERROR:', e.message));
  req.write(payload);
  req.end();

  await sleep(2000);
  serverProcess.kill();
}

runLoadTest().catch(console.error);
