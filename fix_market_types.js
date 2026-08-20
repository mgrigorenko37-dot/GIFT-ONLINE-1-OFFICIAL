const fs = require('fs');

let code = fs.readFileSync('src/types/market.ts', 'utf8');

code = code.replace(
  /export function parseInstrumentKey[\s\S]*?rawCurrency !== 'STARS'\) \{[\s\S]*?\}\n\n  return \{[\s\S]*?\};\n\}/g,
  `export function parseInstrumentKey(instrumentKey: string): ParsedInstrumentKey {
  if (!instrumentKey || typeof instrumentKey !== 'string') {
    throw new Error('instrumentKey must be a non-empty string');
  }
  const parts = instrumentKey.split(':');
  if (parts.length !== 4) {
    // If it doesn't have colons, maybe it's just the direct asset ID (e.g. PLUSH_PEPE_CLASSIC)
    return {
      collectionId: instrumentKey,
      modelId: 'classic',
      backdropId: 'default',
      currency: 'TON',
    };
  }
  const [rawCollection, rawModel, rawBackdrop, rawCurrency] = parts;
  return {
    collectionId: rawCollection,
    modelId: rawModel,
    backdropId: rawBackdrop,
    currency: rawCurrency as Currency,
  };
}`
);

code = code.replace(
  /export function normalizeInstrumentKey[\s\S]*?return buildInstrumentKey\(parsed\);[\s\S]*?\} else \{[\s\S]*?\}\n\}/g,
  `export function normalizeInstrumentKey(
  instrumentKey: string,
  defaultCurrency: Currency = 'TON'
): string {
  if (!instrumentKey) return '';
  const trimmed = instrumentKey.trim();
  if (trimmed.includes(':')) {
    try {
      const parsed = parseInstrumentKey(trimmed);
      return buildInstrumentKey(parsed);
    } catch {
      return trimmed;
    }
  } else {
    // Treat as raw asset id
    return trimmed;
  }
}`
);

fs.writeFileSync('src/types/market.ts', code, 'utf8');
