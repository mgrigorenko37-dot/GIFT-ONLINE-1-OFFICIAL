import fs from 'fs';
import path from 'path';

console.log('🔒 Running Production Security & Math.random Audit...\n');

let hasViolations = false;

// 1. Define exact list of production target directories & files
const targetPaths = ['server', 'src', 'server.ts'];

// 2. Safely resolve existing paths
const existingTargets = targetPaths.filter((p) => fs.existsSync(path.resolve(p)));
console.log(`[Audit Path Resolution] Existing target paths: ${existingTargets.join(', ')}`);

// Verify server/routes and server/workers explicitly
const routesExist = fs.existsSync(path.resolve('server/routes'));
const workersExist = fs.existsSync(path.resolve('server/workers'));
console.log(`[Audit Directory Status] server/routes exists: ${routesExist}`);
console.log(`[Audit Directory Status] server/workers exists: ${workersExist}`);

// 3. Explicitly allowed dev/mock exclusions (checked separately for production guards)
const allowedDevExclusions = new Set([
  path.normalize('server/mockMinter.ts'),
  path.normalize('server/mocks/giftsFixture.ts'),
]);

function isTestOrFixture(filePath) {
  const normalized = path.normalize(filePath);
  if (allowedDevExclusions.has(normalized)) return true;
  if (normalized.endsWith('.test.ts') || normalized.endsWith('.test.js')) return true;
  if (normalized.endsWith('.spec.ts') || normalized.endsWith('.spec.js')) return true;
  if (normalized.startsWith('tests/') || normalized.startsWith('tests\\')) return true;
  return false;
}

function walkDir(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const stat = fs.statSync(dir);
  if (stat.isFile()) return [dir];

  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    if (
      item === 'node_modules' ||
      item === 'dist' ||
      item === 'coverage' ||
      item === '.git'
    ) {
      continue;
    }
    const itemStat = fs.statSync(fullPath);
    if (itemStat.isDirectory()) {
      files = files.concat(walkDir(fullPath));
    } else if (
      fullPath.endsWith('.ts') ||
      fullPath.endsWith('.tsx') ||
      fullPath.endsWith('.js') ||
      fullPath.endsWith('.jsx')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

// 4. Scan production code for Math.random()
console.log('\n--- Checking for Math.random() in Production Source Code ---');
let scannedCount = 0;
let MathRandomCount = 0;

for (const target of existingTargets) {
  const fileList = walkDir(target);
  for (const file of fileList) {
    if (isTestOrFixture(file)) {
      continue;
    }
    scannedCount++;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (line.includes('Math.random(')) {
        console.error(
          `❌ [SECURITY VIOLATION] ${file}:${index + 1}: Found prohibited Math.random()\n   Line: "${line.trim()}"`
        );
        hasViolations = true;
        MathRandomCount++;
      }
    });
  }
}

if (MathRandomCount === 0) {
  console.log(`✅ Scanned ${scannedCount} production source files. ZERO Math.random() found!`);
}

// 5. Verify production guards on dev/simulation modules
console.log('\n--- Verifying Production Guards on Dev/Simulation Modules ---');
if (fs.existsSync('server/mockMinter.ts')) {
  const content = fs.readFileSync('server/mockMinter.ts', 'utf8');
  const hasEnvCheck = content.includes("process.env.NODE_ENV === 'production'");
  const hasSafetyReject = content.includes('SAFETY REJECTION');

  if (!hasEnvCheck || !hasSafetyReject) {
    console.error('❌ [SECURITY VIOLATION] server/mockMinter.ts is missing strict production safety guards!');
    hasViolations = true;
  } else {
    console.log('✅ server/mockMinter.ts has verified production safety guards (NODE_ENV check & rejection).');
  }
}

// 6. Verify Cryptographic Randomness Usage in Core Financial Modules
console.log('\n--- Verifying Cryptographic Randomness Usage in Financial Modules ---');
const financialFiles = [
  'server/routes/financialRoutes.ts',
  'server/invoiceService.ts',
  'server/withdrawalWorker.ts',
  'server/tonAdapter.ts',
  'server/tradingEngine.ts',
  'server/schedulerLease.ts',
];

for (const file of financialFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const hasCrypto = content.includes('crypto.randomUUID') || content.includes('crypto.randomBytes') || content.includes('crypto.randomInt');
    if (!hasCrypto) {
      console.error(`❌ [SECURITY VIOLATION] ${file} does not use crypto module for random ID generation!`);
      hasViolations = true;
    } else {
      console.log(`✅ ${file} uses cryptographically secure random generator.`);
    }
  }
}

// 7. Verify Log Safety (Zero Secret Exposure in Logs)
console.log('\n--- Verifying Log Safety (Zero Secret Exposure in Logs) ---');
const secretEnvVars = [
  'TON_HOT_WALLET_MNEMONIC',
  'TELEGRAM_BOT_TOKEN',
  'BOT_TOKEN',
  'GEMINI_API_KEY',
  'DATABASE_URL',
];

for (const target of existingTargets) {
  const fileList = walkDir(target);
  for (const file of fileList) {
    if (isTestOrFixture(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('console.log') || line.includes('console.error') || line.includes('console.warn')) {
        for (const secretVar of secretEnvVars) {
          if (line.includes(`process.env.${secretVar}`)) {
            // Check if process.env.SECRET is printed directly inside log args
            const regex = new RegExp(`console\\.(log|error|warn)\\(.*process\\.env\\.${secretVar}`);
            if (regex.test(line)) {
              console.error(`❌ [SECURITY VIOLATION] ${file}:${idx + 1}: Printing sensitive env variable process.env.${secretVar} in log statement`);
              hasViolations = true;
            }
          }
        }
      }
    });
  }
}

if (!hasViolations) {
  console.log('✅ Log safety check passed. No secrets exposed in console logs.');
}

if (hasViolations) {
  console.error('\n❌ Security Audit Failed with violations!');
  process.exit(1);
} else {
  console.log('\n🎉 Security Audit Passed Successfully!');
  process.exit(0);
}
