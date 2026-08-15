import { describe, test } from 'vitest';
import { clearMarketState, acceptCompletedSale } from './marketState';
import { clearFloorState, addListing } from './floorManager';
import { getMarketStats } from './marketStats';

describe('Stage 11: Telegram Gifts Market Statistics Scenarios', () => {
  test('Runs Stage 11 Market Statistics Scenarios', () => {
    function assert(condition: boolean, message: string) {
      if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
      }
    }

    console.log('=== Running Stage 11: Telegram Gifts Market Statistics Scenarios ===');

    // 1. Single sale
    {
      clearMarketState();
      clearFloorState();

      addListing({
        listingId: 'lst-1',
        instrumentKey: 'durov-cap:all:all:TON',
        price: '15.0',
        currency: 'TON',
      });

      acceptCompletedSale({
        id: 'sale-1',
        collectionId: 'durov-cap',
        price: '10.5',
        quantity: '2',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });

      const stats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });

      assert(stats.lastSalePrice === '10.5', 'Test 1: lastSalePrice is 10.5');
      assert(stats.lastSaleTime === 1710000000000, 'Test 1: lastSaleTime is 1710000000000');
      assert(stats.floorPrice === '15', 'Test 1: floorPrice is 15');
      assert(stats.listedCount === 1, 'Test 1: listedCount is 1');
      assert(stats.salesCount === 1, 'Test 1: salesCount is 1');
      assert(stats.volume === '2', 'Test 1: volume is 2');
      assert(stats.quoteVolume === '21', 'Test 1: quoteVolume is 21 (10.5 * 2)');
      assert(stats.averageSalePrice === '10.5', 'Test 1: averageSalePrice is 10.5');
      assert(stats.priceChange === '0', 'Test 1: priceChange is 0 for single sale baseline');
      assert(
        stats.priceChangePercent === '0',
        'Test 1: priceChangePercent is 0 for single sale baseline'
      );

      console.log('✓ Test 1 passed: Single sale statistics');
    }

    // 2. Multiple sales & weighted average
    {
      clearMarketState();
      clearFloorState();

      // Sale 1: price 10, qty 1
      acceptCompletedSale({
        id: 'sale-1',
        collectionId: 'durov-cap',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });

      // Sale 2: price 20, qty 3
      acceptCompletedSale({
        id: 'sale-2',
        collectionId: 'durov-cap',
        price: '20',
        quantity: '3',
        currency: 'TON',
        eventTime: 1710000060000,
        status: 'completed',
      });

      const stats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });

      assert(stats.lastSalePrice === '20', 'Test 2: lastSalePrice is 20');
      assert(stats.lastSaleTime === 1710000060000, 'Test 2: lastSaleTime is 1710000060000');
      assert(stats.salesCount === 2, 'Test 2: salesCount is 2');
      assert(stats.volume === '4', 'Test 2: total volume is 1 + 3 = 4');
      assert(stats.quoteVolume === '70', 'Test 2: quoteVolume is 10*1 + 20*3 = 70');
      assert(
        stats.averageSalePrice === '17.5',
        'Test 2: weighted averageSalePrice is 70 / 4 = 17.5'
      );
      assert(stats.priceChange === '10', 'Test 2: priceChange is 20 - 10 = 10');
      assert(
        stats.priceChangePercent === '100',
        'Test 2: priceChangePercent is (10 / 10) * 100 = 100%'
      );

      console.log('✓ Test 2 passed: Multiple sales & weighted average calculation');
    }

    // 3. No sales
    {
      clearMarketState();
      clearFloorState();

      addListing({
        listingId: 'lst-1',
        instrumentKey: 'durov-cap:all:all:TON',
        price: '25.0',
        currency: 'TON',
      });

      const stats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });

      assert(
        stats.lastSalePrice === null,
        'Test 3: lastSalePrice must be null when no sales exist'
      );
      assert(stats.lastSaleTime === null, 'Test 3: lastSaleTime must be null when no sales exist');
      assert(stats.averageSalePrice === null, 'Test 3: averageSalePrice must be null');
      assert(stats.salesCount === 0, 'Test 3: salesCount must be 0');
      assert(stats.volume === null, 'Test 3: volume must be null');
      assert(stats.quoteVolume === null, 'Test 3: quoteVolume must be null');
      assert(stats.priceChange === null, 'Test 3: priceChange must be null');
      assert(stats.priceChangePercent === null, 'Test 3: priceChangePercent must be null');
      assert(stats.floorPrice === '25', 'Test 3: floorPrice remains 25');
      assert(stats.listedCount === 1, 'Test 3: listedCount remains 1');

      console.log('✓ Test 3 passed: No sales yields nulls for sales/price fields');
    }

    // 4. No active listings
    {
      clearMarketState();
      clearFloorState();

      acceptCompletedSale({
        id: 'sale-1',
        collectionId: 'durov-cap',
        price: '12',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });

      const stats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });

      assert(stats.floorPrice === null, 'Test 4: floorPrice must be null when no listings exist');
      assert(stats.listedCount === 0, 'Test 4: listedCount must be 0 when no listings exist');
      assert(stats.lastSalePrice === '12', 'Test 4: lastSalePrice is 12');

      console.log('✓ Test 4 passed: No listings yields floorPrice = null and listedCount = 0');
    }

    // 5. Currency isolation (TON vs STARS)
    {
      clearMarketState();
      clearFloorState();

      acceptCompletedSale({
        id: 'sale-ton',
        collectionId: 'durov-cap',
        price: '15',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });

      acceptCompletedSale({
        id: 'sale-stars',
        collectionId: 'durov-cap',
        price: '1500',
        quantity: '1',
        currency: 'STARS',
        eventTime: 1710000000000,
        status: 'completed',
      });

      const tonStats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });
      const starsStats = getMarketStats({
        instrumentKey: 'durov-cap:all:all:STARS',
        currency: 'STARS',
      });

      assert(tonStats.lastSalePrice === '15', 'Test 5: TON lastSalePrice is 15');
      assert(tonStats.currency === 'TON', 'Test 5: TON currency is TON');
      assert(starsStats.lastSalePrice === '1500', 'Test 5: STARS lastSalePrice is 1500');
      assert(starsStats.currency === 'STARS', 'Test 5: STARS currency is STARS');

      console.log('✓ Test 5 passed: TON and STARS statistics are strictly isolated');
    }

    // 6. Timeframe / From-To filtering
    {
      clearMarketState();
      clearFloorState();

      const base = 1710000000000;

      // Sale 1 at t = base + 1000
      acceptCompletedSale({
        id: 's-old',
        collectionId: 'durov-cap',
        price: '5',
        quantity: '1',
        currency: 'TON',
        eventTime: base + 1000,
        status: 'completed',
      });

      // Sale 2 at t = base + 5000
      acceptCompletedSale({
        id: 's-mid',
        collectionId: 'durov-cap',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: base + 5000,
        status: 'completed',
      });

      // Sale 3 at t = base + 9000
      acceptCompletedSale({
        id: 's-new',
        collectionId: 'durov-cap',
        price: '15',
        quantity: '1',
        currency: 'TON',
        eventTime: base + 9000,
        status: 'completed',
      });

      // Filter window: from base + 4000 to base + 8000 (includes only s-mid)
      const windowStats = getMarketStats({
        instrumentKey: 'durov-cap:all:all:TON',
        currency: 'TON',
        from: base + 4000,
        to: base + 8000,
      });

      assert(windowStats.salesCount === 1, 'Test 6: Only 1 sale in range [base+4000, base+8000)');
      assert(windowStats.lastSalePrice === '10', 'Test 6: lastSalePrice in window is 10');
      assert(windowStats.volume === '1', 'Test 6: volume in window is 1');

      console.log('✓ Test 6 passed: Time range from-to filtering accurately restricts sales scope');
    }

    // 7. Baseline Price Change calculation
    {
      clearMarketState();
      clearFloorState();

      acceptCompletedSale({
        id: 's1',
        collectionId: 'durov-cap',
        price: '50',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });

      acceptCompletedSale({
        id: 's2',
        collectionId: 'durov-cap',
        price: '75',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000060000,
        status: 'completed',
      });

      const stats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });

      assert(stats.priceChange === '25', 'Test 7: priceChange is 75 - 50 = 25');
      assert(
        stats.priceChangePercent === '50',
        'Test 7: priceChangePercent is (25 / 50) * 100 = 50%'
      );

      console.log(
        '✓ Test 7 passed: Price change baseline (first completed sale in range) is accurate'
      );
    }

    // 8. Late adjustment / Out-of-order sale insertion
    {
      clearMarketState();
      clearFloorState();

      // Insert Sale at t = 1710000060000 first
      acceptCompletedSale({
        id: 's-late-rec',
        collectionId: 'durov-cap',
        price: '20',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000060000,
        status: 'completed',
      });

      // Now insert an earlier sale at t = 1710000000000 out-of-order
      acceptCompletedSale({
        id: 's-earlier',
        collectionId: 'durov-cap',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });

      const stats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });

      assert(
        stats.lastSalePrice === '20',
        'Test 8: lastSalePrice remains 20 (chronologically latest eventTime)'
      );
      assert(stats.lastSaleTime === 1710000060000, 'Test 8: lastSaleTime is 1710000060000');
      assert(
        stats.priceChange === '10',
        'Test 8: priceChange is 20 - 10 = 10 after chronological sorting'
      );

      console.log('✓ Test 8 passed: Out-of-order sales are sorted chronologically by eventTime');
    }

    // 9. Duplicate sale rejection
    {
      clearMarketState();
      clearFloorState();

      acceptCompletedSale({
        id: 's-dup',
        collectionId: 'durov-cap',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });

      // Duplicate delivery of same sale
      acceptCompletedSale({
        id: 's-dup',
        collectionId: 'durov-cap',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });

      const stats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });

      assert(stats.salesCount === 1, 'Test 9: Duplicate sale rejected, salesCount is 1');
      assert(stats.volume === '1', 'Test 9: Volume is 1, not duplicated');

      console.log('✓ Test 9 passed: Duplicate sales are ignored in stats calculation');
    }

    // 10. Non-completed / Pending / Cancelled sales rejection
    {
      clearMarketState();
      clearFloorState();

      acceptCompletedSale({
        id: 's-pending',
        collectionId: 'durov-cap',
        price: '100',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'pending',
      });

      acceptCompletedSale({
        id: 's-cancelled',
        collectionId: 'durov-cap',
        price: '100',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'cancelled',
      });

      const stats = getMarketStats({ instrumentKey: 'durov-cap:all:all:TON', currency: 'TON' });

      assert(stats.salesCount === 0, 'Test 10: Non-completed sales rejected, salesCount is 0');
      assert(stats.lastSalePrice === null, 'Test 10: lastSalePrice is null');

      console.log('✓ Test 10 passed: Non-completed/pending/cancelled sales are excluded');
    }
  });
});
