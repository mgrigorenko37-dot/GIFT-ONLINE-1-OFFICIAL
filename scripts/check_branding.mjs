import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_REPO = 'mgrigorenko37-dot/GIFT-ONLINE-1-OFFICIAL';
const EXPECTED_PRODUCT_NAME = 'GX Exchange';
const OUTDATED_REPOS = ['mgrigorenko37-dot/gx-exchange', 'mgrigorenko37-dot/Gift-Exchange'];

let errors = 0;

function logError(msg) {
  console.error(`❌ [Branding Check] ${msg}`);
  errors++;
}

function logOk(msg) {
  console.log(`✓ [Branding Check] ${msg}`);
}

// 1. Check README.md
if (fs.existsSync('README.md')) {
  const readme = fs.readFileSync('README.md', 'utf8');

  // Check outdated repos
  for (const oldRepo of OUTDATED_REPOS) {
    if (readme.includes(oldRepo)) {
      logError(`README.md contains outdated repository reference "${oldRepo}"`);
    }
  }

  // Check expected CI badge
  const expectedBadge = `https://github.com/${EXPECTED_REPO}/actions/workflows/ci.yml`;
  if (!readme.includes(expectedBadge)) {
    logError(`README.md does not contain current CI workflow link/badge "${expectedBadge}"`);
  } else {
    logOk(`README.md correctly references repository ${EXPECTED_REPO} and CI badge.`);
  }
} else {
  logError('README.md is missing');
}

// 2. Check Product Name Consistency
const filesToCheckProduct = [
  { path: 'metadata.json', field: 'name' },
  { path: 'public/tonconnect-manifest.json', field: 'name' },
];

for (const item of filesToCheckProduct) {
  if (fs.existsSync(item.path)) {
    try {
      const data = JSON.parse(fs.readFileSync(item.path, 'utf8'));
      if (data[item.field] !== EXPECTED_PRODUCT_NAME) {
        logError(
          `${item.path} field "${item.field}" is "${data[item.field]}", expected "${EXPECTED_PRODUCT_NAME}"`
        );
      } else {
        logOk(`${item.path} product name is "${EXPECTED_PRODUCT_NAME}".`);
      }
    } catch (e) {
      logError(`Failed to parse JSON in ${item.path}: ${e.message}`);
    }
  }
}

// Check index.html title
if (fs.existsSync('index.html')) {
  const html = fs.readFileSync('index.html', 'utf8');
  if (!html.includes(`<title>${EXPECTED_PRODUCT_NAME}</title>`)) {
    logError(`index.html title does not match expected "${EXPECTED_PRODUCT_NAME}"`);
  } else {
    logOk(`index.html title matches "${EXPECTED_PRODUCT_NAME}".`);
  }
}

// 3. Check TonConnect Manifest URLs
if (fs.existsSync('public/tonconnect-manifest.json')) {
  const manifest = fs.readFileSync('public/tonconnect-manifest.json', 'utf8');
  if (manifest.includes('demo-dapp') || manifest.includes('ton-connect.github.io')) {
    logError('public/tonconnect-manifest.json contains placeholder/demo URLs (demo-dapp)');
  } else {
    logOk('public/tonconnect-manifest.json free of placeholder demo-dapp URLs.');
  }
}

// Check src/index.tsx for demo-dapp fallback
if (fs.existsSync('src/index.tsx')) {
  const srcIndex = fs.readFileSync('src/index.tsx', 'utf8');
  if (srcIndex.includes('demo-dapp') || srcIndex.includes('ton-connect.github.io')) {
    logError('src/index.tsx contains placeholder demo-dapp fallback URL');
  } else {
    logOk('src/index.tsx free of placeholder demo-dapp URLs.');
  }
}

if (errors > 0) {
  console.error(`\nBranding check failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log('\nAll branding, repository link, and product name checks PASSED.');
  process.exit(0);
}
