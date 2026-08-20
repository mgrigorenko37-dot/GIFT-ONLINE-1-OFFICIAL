import crypto from 'crypto';
import { acceptCompletedSale } from './marketState';

export function simulateSales(io: any) {
  const isProduction = process.env.NODE_ENV === 'production';
  const isSimulationEnabled =
    process.env.SIMULATION_MODE === 'true' || process.env.ENABLE_SIMULATION === 'true';

  if (!isSimulationEnabled) {
    console.log(
      '[mockMinter] Simulation disabled. (Set SIMULATION_MODE=true or ENABLE_SIMULATION=true to enable)'
    );
    return;
  }

  if (isProduction && process.env.ALLOW_SIMULATION_IN_PRODUCTION !== 'true') {
    console.warn(
      '[mockMinter] SAFETY REJECTION: Mock simulation is disabled in production environments by default.'
    );
    return;
  }

  process.env.SIMULATION_MODE = 'true';
  console.log('[mockMinter] Starting mock sales simulation engine...');

  setInterval(() => {
    const randSuffix = crypto.randomBytes(4).toString('hex');
    const priceDelta = (crypto.randomInt(0, 500) - 250) / 100;
    const sale: any = {
      id: `mock_${Date.now()}_${randSuffix}`,
      collectionId: 'durov-cap',
      price: (124 + priceDelta).toFixed(2),
      quantity: '1',
      currency: 'TON',
      eventTime: Date.now(),
      createdAt: Date.now(),
      status: 'completed',
      isMock: true,
      isSimulation: true,
      source: 'simulation',
    };

    acceptCompletedSale(sale);
  }, 15000);
}
