import { describe, it, expect, beforeEach } from 'vitest';
import { acceptCompletedSale, clearMarketState, allSales, processedSaleIds } from './marketState';

describe('Multi-Instance & Concurrency Verification', () => {
  beforeEach(() => {
    clearMarketState();
  });

  it('prevents double aggregation when two backend processes receive the same sale simultaneously', () => {
    const sale = {
      id: 'concurrent_sale_100',
      collectionId: 'durov-cap',
      currency: 'TON',
      price: '120.00',
      quantity: '1',
      eventTime: 1770000000000,
      status: 'completed',
    };

    // Process instance A
    const resA = acceptCompletedSale(sale);
    expect(resA.accepted).toBe(true);

    // Process instance B receiving same sale
    const resB = acceptCompletedSale(sale);
    expect(resB.accepted).toBe(false);
    expect(resB.reason).toBe('duplicate');

    // Only 1 sale recorded in market history
    expect(allSales.length).toBe(1);
    expect(processedSaleIds.has('concurrent_sale_100')).toBe(true);
  });

  it('rejects simulation sales when SIMULATION_MODE is disabled in production environment', () => {
    const origSim = process.env.SIMULATION_MODE;
    const origNodeEnv = process.env.NODE_ENV;

    try {
      delete process.env.SIMULATION_MODE;
      process.env.NODE_ENV = 'production';

      const mockSale = {
        id: 'mock_prod_001',
        collectionId: 'durov-cap',
        currency: 'TON',
        price: '120.00',
        quantity: '1',
        eventTime: 1770000000000,
        status: 'completed',
        isMock: true,
      };

      const res = acceptCompletedSale(mockSale);
      expect(res.accepted).toBe(false);
      expect(res.reason).toBe('invalid');
      expect(allSales.length).toBe(0);
    } finally {
      if (origSim) process.env.SIMULATION_MODE = origSim;
      if (origNodeEnv) process.env.NODE_ENV = origNodeEnv;
    }
  });
});
