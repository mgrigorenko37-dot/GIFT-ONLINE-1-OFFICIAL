import { describe, test } from 'vitest';
import { acceptCompletedSale, clearMarketState, getHistory } from './marketState';
import { handleGetCandles } from './candlesHandler';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function mockApiCall(query: Record<string, any>) {
  let statusCode = 200;
  let jsonBody: any = null;

  const req: any = { query };
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: any) {
      jsonBody = body;
      return res;
    },
  };

  await handleGetCandles(req, res);
  return { status: statusCode, body: jsonBody };
}

describe('Stage 5: 33 REST API Candle History Scenarios', () => {
  test('Runs all 33 REST API Candle History Scenarios', async () => {
    // Scenario 1: Successful request 1s
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1s' });
      assert(res.status === 200, 'Scenario 1: HTTP status 200');
      assert(res.body.candles.length === 1, 'Scenario 1: returns 1s candle');
      assert(res.body.timeframe === '1s', 'Scenario 1: timeframe is 1s');
      console.log('✓ Scenario 1 passed: Successful request 1s');
    }

    // Scenario 2: Successful request 1m
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      assert(res.status === 200, 'Scenario 2: HTTP status 200');
      assert(res.body.timeframe === '1m', 'Scenario 2: timeframe is 1m');
      console.log('✓ Scenario 2 passed: Successful request 1m');
    }

    // Scenario 3: Successful request 5m
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '5m' });
      assert(res.status === 200, 'Scenario 3: HTTP status 200');
      assert(res.body.timeframe === '5m', 'Scenario 3: timeframe is 5m');
      console.log('✓ Scenario 3 passed: Successful request 5m');
    }

    // Scenario 4: Successful request 15m
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '15m' });
      assert(res.status === 200, 'Scenario 4: HTTP status 200');
      assert(res.body.timeframe === '15m', 'Scenario 4: timeframe is 15m');
      console.log('✓ Scenario 4 passed: Successful request 15m');
    }

    // Scenario 5: Successful request 1h
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1h' });
      assert(res.status === 200, 'Scenario 5: HTTP status 200');
      assert(res.body.timeframe === '1h', 'Scenario 5: timeframe is 1h');
      console.log('✓ Scenario 5 passed: Successful request 1h');
    }

    // Scenario 6: Successful request 4h
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '4h' });
      assert(res.status === 200, 'Scenario 6: HTTP status 200');
      assert(res.body.timeframe === '4h', 'Scenario 6: timeframe is 4h');
      console.log('✓ Scenario 6 passed: Successful request 4h');
    }

    // Scenario 7: Successful request 1d
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1d' });
      assert(res.status === 200, 'Scenario 7: HTTP status 200');
      assert(res.body.timeframe === '1d', 'Scenario 7: timeframe is 1d');
      console.log('✓ Scenario 7 passed: Successful request 1d');
    }

    // Scenario 8: Successful request 1w
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1w' });
      assert(res.status === 200, 'Scenario 8: HTTP status 200');
      assert(res.body.timeframe === '1w', 'Scenario 8: timeframe is 1w');
      console.log('✓ Scenario 8 passed: Successful request 1w');
    }

    // Scenario 9: Successful request 1M
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1M' });
      assert(res.status === 200, 'Scenario 9: HTTP status 200');
      assert(res.body.timeframe === '1M', 'Scenario 9: timeframe is 1M');
      console.log('✓ Scenario 9 passed: Successful request 1M');
    }

    // Scenario 10: 1m and 1M return different series
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c1',
        price: '12',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000120000,
        status: 'completed',
      }); // +2m
      const res1m = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      const res1M = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1M' });
      assert(res1m.body.candles.length === 2, 'Scenario 10: 1m has 2 candles');
      assert(res1M.body.candles.length === 1, 'Scenario 10: 1M has 1 candle');
      console.log('✓ Scenario 10 passed: 1m and 1M return different series');
    }

    // Scenario 11: TON and STARS return different series
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c1',
        price: '500',
        quantity: '1',
        currency: 'STARS',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const resTon = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      const resStars = await mockApiCall({ instrumentKey: 'c1:all:all:STARS', timeframe: '1m' });
      assert(resTon.body.candles[0].close === '10', 'Scenario 11: TON close is 10');
      assert(resStars.body.candles[0].close === '500', 'Scenario 11: STARS close is 500');
      console.log('✓ Scenario 11 passed: TON and STARS return different series');
    }

    // Scenario 12: Different collections isolated
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c2',
        price: '20',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const resC1 = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      const resC2 = await mockApiCall({ instrumentKey: 'c2:all:all:TON', timeframe: '1m' });
      assert(resC1.body.candles[0].close === '10', 'Scenario 12: c1 close is 10');
      assert(resC2.body.candles[0].close === '20', 'Scenario 12: c2 close is 20');
      console.log('✓ Scenario 12 passed: Different collections isolated');
    }

    // Scenario 13: Different modelId isolated
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        modelId: 'm1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c1',
        modelId: 'm2',
        price: '30',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const resM1 = await mockApiCall({ instrumentKey: 'c1:m1:all:TON', timeframe: '1m' });
      const resM2 = await mockApiCall({ instrumentKey: 'c1:m2:all:TON', timeframe: '1m' });
      assert(resM1.body.candles[0].close === '10', 'Scenario 13: m1 close is 10');
      assert(resM2.body.candles[0].close === '30', 'Scenario 13: m2 close is 30');
      console.log('✓ Scenario 13 passed: Different modelId isolated');
    }

    // Scenario 14: Different backdropId isolated
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        backdropId: 'b1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c1',
        backdropId: 'b2',
        price: '40',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const resB1 = await mockApiCall({ instrumentKey: 'c1:all:b1:TON', timeframe: '1m' });
      const resB2 = await mockApiCall({ instrumentKey: 'c1:all:b2:TON', timeframe: '1m' });
      assert(resB1.body.candles[0].close === '10', 'Scenario 14: b1 close is 10');
      assert(resB2.body.candles[0].close === '40', 'Scenario 14: b2 close is 40');
      console.log('✓ Scenario 14 passed: Different backdropId isolated');
    }

    // Scenario 15: from included (startTime >= from)
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({
        instrumentKey: 'c1:all:all:TON',
        timeframe: '1m',
        from: 1710000000000,
      });
      assert(res.body.candles.length === 1, 'Scenario 15: Candle starting at from is included');
      console.log('✓ Scenario 15 passed: from included');
    }

    // Scenario 16: to excluded (startTime < to)
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({
        instrumentKey: 'c1:all:all:TON',
        timeframe: '1m',
        to: 1710000000000,
      });
      assert(res.body.candles.length === 0, 'Scenario 16: Candle starting at to is excluded');
      console.log('✓ Scenario 16 passed: to excluded');
    }

    // Scenario 17: from == to gives empty result
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({
        instrumentKey: 'c1:all:all:TON',
        timeframe: '1m',
        from: 1710000000000,
        to: 1710000000000,
      });
      assert(res.status === 200, 'Scenario 17: Status 200');
      assert(res.body.candles.length === 0, 'Scenario 17: Candles length is 0 when from == to');
      console.log('✓ Scenario 17 passed: from == to gives empty result');
    }

    // Scenario 18: from > to rejected
    {
      const res = await mockApiCall({
        instrumentKey: 'c1:all:all:TON',
        timeframe: '1m',
        from: 1710000000000,
        to: 1700000000000,
      });
      assert(res.status === 400, 'Scenario 18: Status 400 when from > to');
      console.log('✓ Scenario 18 passed: from > to rejected');
    }

    // Scenario 19: Invalid timeframe rejected
    {
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '10m' });
      assert(res.status === 400, 'Scenario 19: Status 400 for invalid timeframe 10m');
      console.log('✓ Scenario 19 passed: Invalid timeframe rejected');
    }

    // Scenario 20: Invalid currency rejected
    {
      const res = await mockApiCall({ collectionId: 'c1', currency: 'USD', timeframe: '1m' });
      assert(res.status === 400, 'Scenario 20: Status 400 for invalid currency USD');
      console.log('✓ Scenario 20 passed: Invalid currency rejected');
    }

    // Scenario 21: Invalid instrumentKey rejected
    {
      const res = await mockApiCall({ instrumentKey: 'invalid_key_without_colons', timeframe: '1m' });
      assert(res.status === 400, 'Scenario 21: Status 400 for invalid instrumentKey format');
      console.log('✓ Scenario 21 passed: Invalid instrumentKey rejected');
    }

    // Scenario 22: Timestamp in seconds rejected
    {
      const res = await mockApiCall({
        instrumentKey: 'c1:all:all:TON',
        timeframe: '1m',
        from: 1710000000,
      });
      assert(res.status === 400, 'Scenario 22: Status 400 when from is passed in seconds');
      console.log('✓ Scenario 22 passed: Timestamp in seconds rejected');
    }

    // Scenario 23: Negative timestamp rejected
    {
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m', from: -100 });
      assert(res.status === 400, 'Scenario 23: Status 400 for negative timestamp');
      console.log('✓ Scenario 23 passed: Negative timestamp rejected');
    }

    // Scenario 24: limit restricts number of candles
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c1',
        price: '12',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000060000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's3',
        collectionId: 'c1',
        price: '14',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000120000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m', limit: 2 });
      assert(res.body.candles.length === 2, 'Scenario 24: limit 2 restricts candle count to 2');
      assert(res.body.hasMore === true, 'Scenario 24: hasMore is true');
      console.log('✓ Scenario 24 passed: limit restricts candle count');
    }

    // Scenario 25: History sorted by startTime ASC
    {
      clearMarketState();
      acceptCompletedSale({
        id: 'sLater',
        collectionId: 'c1',
        price: '12',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000120000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 'sEarlier',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      assert(
        res.body.candles[0].startTime < res.body.candles[1].startTime,
        'Scenario 25: Sorted ASC'
      );
      console.log('✓ Scenario 25 passed: History sorted by startTime ASC');
    }

    // Scenario 26: Duplicates absent
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c1',
        price: '12',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000010000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      assert(res.body.candles.length === 1, 'Scenario 26: Only 1 candle for same interval');
      console.log('✓ Scenario 26 passed: Duplicates absent');
    }

    // Scenario 27: Empty history does not cause 500
    {
      clearMarketState();
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      assert(res.status === 200, 'Scenario 27: Status 200 for empty history');
      assert(
        Array.isArray(res.body.candles) && res.body.candles.length === 0,
        'Scenario 27: Empty candles array'
      );
      console.log('✓ Scenario 27 passed: Empty history returns 200 with empty array');
    }

    // Scenario 28: Returns active candle if present
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: Date.now(),
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      assert(res.body.candles.length === 1, 'Scenario 28: Active candle returned');
      assert(
        res.body.candles[0].confirmed === false,
        'Scenario 28: Active candle confirmed is false'
      );
      console.log('✓ Scenario 28 passed: Returns active candle if present');
    }

    // Scenario 29: Late adjustment returns updated candle
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '100',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000010000,
        status: 'completed',
      });
      acceptCompletedSale({
        id: 's2',
        collectionId: 'c1',
        price: '120',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000070000,
        status: 'completed',
      }); // next candle
      acceptCompletedSale({
        id: 'sLate',
        collectionId: 'c1',
        price: '150',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000020000,
        status: 'completed',
      }); // late in first candle
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      assert(
        res.body.candles[0].high === '150',
        'Scenario 29: Closed candle updated with new high'
      );
      assert(res.body.candles[0].revision === 2, 'Scenario 29: Revision incremented');
      console.log('✓ Scenario 29 passed: Late adjustment returns updated candle');
    }

    // Scenario 30: Monetary values are exact strings
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '0.1',
        quantity: '3',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      const c = res.body.candles[0];
      assert(typeof c.open === 'string' && c.open === '0.1', "Scenario 30: open is string '0.1'");
      assert(
        typeof c.quoteVolume === 'string' && c.quoteVolume === '0.3',
        "Scenario 30: quoteVolume is string '0.3'"
      );
      console.log('✓ Scenario 30 passed: Monetary values are exact strings');
    }

    // Scenario 31: Response contains no NaN and Infinity
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      const str = JSON.stringify(res.body);
      assert(!str.includes('NaN'), 'Scenario 31: No NaN');
      assert(!str.includes('Infinity'), 'Scenario 31: No Infinity');
      console.log('✓ Scenario 31 passed: Response contains no NaN and Infinity');
    }

    // Scenario 32: revision returned correctly
    {
      clearMarketState();
      acceptCompletedSale({
        id: 's1',
        collectionId: 'c1',
        price: '10',
        quantity: '1',
        currency: 'TON',
        eventTime: 1710000000000,
        status: 'completed',
      });
      const res = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m' });
      assert(res.body.candles[0].revision === 1, 'Scenario 32: revision is 1');
      console.log('✓ Scenario 32 passed: revision returned correctly');
    }

    // Scenario 33: Cursor pagination does not skip or duplicate candles
    {
      clearMarketState();
      for (let i = 0; i < 5; i++) {
        acceptCompletedSale({
          id: `sale_${i}`,
          collectionId: 'c1',
          price: '10',
          quantity: '1',
          currency: 'TON',
          eventTime: 1710000000000 + i * 60000, // 5 separate minute candles
          status: 'completed',
        });
      }

      // Page 1: limit 2
      const p1 = await mockApiCall({ instrumentKey: 'c1:all:all:TON', timeframe: '1m', limit: 2 });
      assert(p1.body.candles.length === 2, 'Scenario 33: Page 1 length is 2');
      assert(p1.body.hasMore === true, 'Scenario 33: Page 1 hasMore is true');
      assert(
        p1.body.nextCursor === '1710000060000',
        'Scenario 33: Page 1 nextCursor is 1710000060000'
      );

      // Page 2: use cursor from Page 1
      const p2 = await mockApiCall({
        instrumentKey: 'c1:all:all:TON',
        timeframe: '1m',
        limit: 2,
        cursor: p1.body.nextCursor,
      });
      assert(p2.body.candles.length === 2, 'Scenario 33: Page 2 length is 2');
      assert(
        p2.body.candles[0].startTime === 1710000120000,
        'Scenario 33: Page 2 starts at next candle without duplicate'
      );
      assert(
        p2.body.nextCursor === '1710000180000',
        'Scenario 33: Page 2 nextCursor is 1710000180000'
      );

      // Page 3: use cursor from Page 2
      const p3 = await mockApiCall({
        instrumentKey: 'c1:all:all:TON',
        timeframe: '1m',
        limit: 2,
        cursor: p2.body.nextCursor,
      });
      assert(p3.body.candles.length === 1, 'Scenario 33: Page 3 length is 1');
      assert(p3.body.hasMore === false, 'Scenario 33: Page 3 hasMore is false');
      assert(p3.body.nextCursor === null, 'Scenario 33: Page 3 nextCursor is null');

      console.log('✓ Scenario 33 passed: Cursor pagination does not skip or duplicate candles');
    }
  });
});
