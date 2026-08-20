import { parseInstrumentKey } from '../../src/types/market';
import { MOCK_GIFTS_FIXTURE } from '../mocks/giftsFixture';
import { InstrumentCurrencyConfig } from './types';

const INSTRUMENT_CURRENCY_MAP: Record<string, InstrumentCurrencyConfig> = {};

function validateRates(config: InstrumentCurrencyConfig) {
  if (
    typeof config.maintenanceMarginRate !== 'number' ||
    isNaN(config.maintenanceMarginRate) ||
    !isFinite(config.maintenanceMarginRate) ||
    config.maintenanceMarginRate < 0 ||
    config.maintenanceMarginRate > 1
  ) {
    throw new Error('Invalid maintenanceMarginRate');
  }
  if (
    typeof config.liquidationFeeRate !== 'number' ||
    isNaN(config.liquidationFeeRate) ||
    !isFinite(config.liquidationFeeRate) ||
    config.liquidationFeeRate < 0 ||
    config.liquidationFeeRate > 1
  ) {
    throw new Error('Invalid liquidationFeeRate');
  }
  if (config.liquidationBuffer !== undefined) {
    if (
      typeof config.liquidationBuffer !== 'number' ||
      isNaN(config.liquidationBuffer) ||
      !isFinite(config.liquidationBuffer) ||
      config.liquidationBuffer < 0 ||
      config.liquidationBuffer > 1
    ) {
      throw new Error('Invalid liquidationBuffer');
    }
  }
  if (
    typeof config.maxLiquidationRetries !== 'number' ||
    isNaN(config.maxLiquidationRetries) ||
    !isFinite(config.maxLiquidationRetries) ||
    config.maxLiquidationRetries < 0
  ) {
    throw new Error('Invalid maxLiquidationRetries');
  }
}

export function defineInstrument(
  key: string,
  currency: string,
  opts?: Partial<InstrumentCurrencyConfig>
) {
  const config: InstrumentCurrencyConfig = {
    settlementCurrency: currency,
    collateralCurrency: currency,
    feeCurrency: currency,
    pnlCurrency: currency,
    maintenanceMarginRate: opts?.maintenanceMarginRate ?? 0.05,
    liquidationFeeRate: opts?.liquidationFeeRate ?? 0.01,
    liquidationBuffer: opts?.liquidationBuffer ?? 0.005,
    markPriceSource: opts?.markPriceSource ?? 'internal_orderbook',
    maxLiquidationRetries: opts?.maxLiquidationRetries ?? 3,
    ...opts,
  };
  validateRates(config);
  INSTRUMENT_CURRENCY_MAP[key] = config;
}

defineInstrument('TON', 'TON');
defineInstrument('TON-USDT', 'TON');
defineInstrument('STARS', 'STARS');
defineInstrument('STARS-USDT', 'STARS');

for (const gift of MOCK_GIFTS_FIXTURE) {
  defineInstrument(gift.id, 'TON');
  defineInstrument(`${gift.id}:all:all:TON`, 'TON');
}
defineInstrument('star', 'STARS');
defineInstrument('star:all:all:STARS', 'STARS');

export function getInstrumentConfig(instrumentKey: string): InstrumentCurrencyConfig {
  const config = INSTRUMENT_CURRENCY_MAP[instrumentKey];
  if (config) return config;

  let curr: 'TON' | 'STARS' | undefined = undefined;
  if (instrumentKey) {
    if (
      instrumentKey.endsWith(':STARS') ||
      instrumentKey.includes('STARS') ||
      instrumentKey === 'star'
    ) {
      curr = 'STARS';
    } else if (
      instrumentKey.endsWith(':TON') ||
      instrumentKey.includes('TON') ||
      instrumentKey === 'TON' ||
      instrumentKey === 'TON-USDT'
    ) {
      curr = 'TON';
    } else if (instrumentKey.includes(':')) {
      try {
        const parsed = parseInstrumentKey(instrumentKey);
        if (parsed.currency === 'TON' || parsed.currency === 'STARS') {
          curr = parsed.currency;
        }
      } catch (e) {}
    }
  }

  const defaultConfig: InstrumentCurrencyConfig = {
    settlementCurrency: curr as any,
    collateralCurrency: curr as any,
    feeCurrency: curr as any,
    pnlCurrency: curr as any,
    maintenanceMarginRate: 0.05,
    liquidationFeeRate: 0.01,
    liquidationBuffer: 0.005,
    markPriceSource: 'internal_orderbook',
    maxLiquidationRetries: 3,
  };
  return defaultConfig;
}
