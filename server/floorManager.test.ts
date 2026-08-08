import {
  clearFloorState,
  addListing,
  updateListingPrice,
  cancelListing,
  expireListing,
  sellListing,
  getFloorPrice,
  onFloorUpdated,
  FloorResult,
} from './floorManager';
import { clearMarketState, acceptCompletedSale, getHistory, allSales } from './marketState';
import { GiftSale } from './chartEngine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('=== Running Stage 10: Telegram Gifts Floor Price System Scenarios ===');

// 1. Active listing & floor calculation
{
  clearFloorState();

  const addRes1 = addListing({
    listingId: 'lst-1',
    instrumentKey: 'durov-cap:all:all:TON',
    price: '15.5',
    currency: 'TON',
  });

  assert(addRes1.success === true, 'Test 1: Active listing 1 must be added');
  assert(addRes1.floor?.floorPrice === '15.5', 'Test 1: Floor price must be 15.5');
  assert(addRes1.floor?.listedCount === 1, 'Test 1: Listed count must be 1');

  const addRes2 = addListing({
    listingId: 'lst-2',
    instrumentKey: 'durov-cap:all:all:TON',
    price: '10.2',
    currency: 'TON',
  });

  assert(addRes2.success === true, 'Test 1: Active listing 2 must be added');
  assert(addRes2.floor?.floorPrice === '10.2', 'Test 1: Floor price must drop to minimum 10.2');
  assert(addRes2.floor?.listedCount === 2, 'Test 1: Listed count must be 2');

  console.log('✓ Test 1 passed: Active listing & minimum floor calculation');
}

// 2. Cancellation
{
  clearFloorState();

  addListing({ listingId: 'lst-1', instrumentKey: 'durov-cap:all:all:TON', price: '10.0', currency: 'TON' });
  addListing({ listingId: 'lst-2', instrumentKey: 'durov-cap:all:all:TON', price: '20.0', currency: 'TON' });

  let floor = getFloorPrice('durov-cap:all:all:TON');
  assert(floor.floorPrice === '10', 'Test 2: Initial floor is 10');
  assert(floor.listedCount === 2, 'Test 2: Initial listed count is 2');

  const cancelRes = cancelListing('lst-1');
  assert(cancelRes.success === true, 'Test 2: Cancel lst-1 must succeed');

  floor = getFloorPrice('durov-cap:all:all:TON');
  assert(floor.floorPrice === '20', 'Test 2: Floor price increases to 20 after cancelling lowest listing');
  assert(floor.listedCount === 1, 'Test 2: Listed count decreases to 1');

  console.log('✓ Test 2 passed: Listing cancellation updates floor');
}

// 3. Sale (status = "sold")
{
  clearFloorState();

  addListing({ listingId: 'lst-1', instrumentKey: 'durov-cap:all:all:TON', price: '12.0', currency: 'TON' });
  addListing({ listingId: 'lst-2', instrumentKey: 'durov-cap:all:all:TON', price: '18.0', currency: 'TON' });

  const sellRes = sellListing('lst-1');
  assert(sellRes.success === true, 'Test 3: Sell lst-1 must succeed');

  const floor = getFloorPrice('durov-cap:all:all:TON');
  assert(floor.floorPrice === '18', 'Test 3: Floor price updates to 18 after lowest item sold');
  assert(floor.listedCount === 1, 'Test 3: Listed count becomes 1');

  console.log('✓ Test 3 passed: Sold status removes listing from floor calculation');
}

// 4. Expiration (status = "expired")
{
  clearFloorState();

  addListing({ listingId: 'lst-1', instrumentKey: 'durov-cap:all:all:TON', price: '8.0', currency: 'TON' });
  addListing({ listingId: 'lst-2', instrumentKey: 'durov-cap:all:all:TON', price: '14.0', currency: 'TON' });

  const expRes = expireListing('lst-1');
  assert(expRes.success === true, 'Test 4: Expire lst-1 must succeed');

  const floor = getFloorPrice('durov-cap:all:all:TON');
  assert(floor.floorPrice === '14', 'Test 4: Floor price updates to 14 after lowest item expired');
  assert(floor.listedCount === 1, 'Test 4: Listed count becomes 1');

  console.log('✓ Test 4 passed: Expired status removes listing from floor calculation');
}

// 5. Price update
{
  clearFloorState();

  addListing({ listingId: 'lst-1', instrumentKey: 'durov-cap:all:all:TON', price: '25.0', currency: 'TON' });
  addListing({ listingId: 'lst-2', instrumentKey: 'durov-cap:all:all:TON', price: '30.0', currency: 'TON' });

  let floor = getFloorPrice('durov-cap:all:all:TON');
  assert(floor.floorPrice === '25', 'Test 5: Initial floor is 25');

  const updateRes = updateListingPrice('lst-1', '18.5');
  assert(updateRes.success === true, 'Test 5: Price update must succeed');

  floor = getFloorPrice('durov-cap:all:all:TON');
  assert(floor.floorPrice === '18.5', 'Test 5: Floor price updates to 18.5');

  console.log('✓ Test 5 passed: Listing price update recalculates floor');
}

// 6. No active listings (listedCount = 0, floorPrice = null)
{
  clearFloorState();

  const floorEmpty = getFloorPrice('durov-cap:all:all:TON');
  assert(floorEmpty.floorPrice === null, 'Test 6: Floor price must be null when no active listings exist');
  assert(floorEmpty.listedCount === 0, 'Test 6: Listed count must be 0 when no active listings exist');

  addListing({ listingId: 'lst-1', instrumentKey: 'durov-cap:all:all:TON', price: '10.0', currency: 'TON' });
  cancelListing('lst-1');

  const floorCancelled = getFloorPrice('durov-cap:all:all:TON');
  assert(floorCancelled.floorPrice === null, 'Test 6: Floor price must revert to null when all listings cancelled');
  assert(floorCancelled.listedCount === 0, 'Test 6: Listed count must be 0 when all listings cancelled');

  console.log('✓ Test 6 passed: No active listings yields floorPrice = null and listedCount = 0');
}

// 7. Currency isolation (TON vs STARS)
{
  clearFloorState();

  addListing({ listingId: 'lst-ton', instrumentKey: 'durov-cap:all:all:TON', price: '50.0', currency: 'TON' });
  addListing({ listingId: 'lst-stars', instrumentKey: 'durov-cap:all:all:STARS', price: '500.0', currency: 'STARS' });

  const tonFloor = getFloorPrice('durov-cap:all:all:TON');
  const starsFloor = getFloorPrice('durov-cap:all:all:STARS');

  assert(tonFloor.floorPrice === '50', 'Test 7: TON floor is 50');
  assert(tonFloor.currency === 'TON', 'Test 7: TON currency isolated');
  assert(starsFloor.floorPrice === '500', 'Test 7: STARS floor is 500');
  assert(starsFloor.currency === 'STARS', 'Test 7: STARS currency isolated');

  console.log('✓ Test 7 passed: TON and STARS currencies are strictly isolated');
}

// 8. Different instrumentKeys (collections / models / backdrops)
{
  clearFloorState();

  addListing({ listingId: 'l1', instrumentKey: 'coll1:model1:bg1:TON', price: '10.0', currency: 'TON' });
  addListing({ listingId: 'l2', instrumentKey: 'coll1:model2:bg1:TON', price: '20.0', currency: 'TON' });

  const floor1 = getFloorPrice('coll1:model1:bg1:TON');
  const floor2 = getFloorPrice('coll1:model2:bg1:TON');

  assert(floor1.floorPrice === '10', 'Test 8: Key 1 floor is 10');
  assert(floor2.floorPrice === '20', 'Test 8: Key 2 floor is 20');

  console.log('✓ Test 8 passed: Instrument key isolation verified');
}

// 9. Floor changes do NOT change OHLCV sales candles
{
  clearFloorState();
  clearMarketState();

  // Initial market state has no candles
  const candlesBefore = getHistory('durov-cap:all:all:TON', '1m', 0, Date.now() + 10000);
  assert(candlesBefore.length === 0, 'Test 9: No candles initially');

  // Add listing, update price, cancel listing
  addListing({ listingId: 'l-test', instrumentKey: 'durov-cap:all:all:TON', price: '5.0', currency: 'TON' });
  updateListingPrice('l-test', '6.0');
  cancelListing('l-test');

  // Verify OHLCV sales candles remain completely unchanged (empty)
  const candlesAfter = getHistory('durov-cap:all:all:TON', '1m', 0, Date.now() + 10000);
  assert(candlesAfter.length === 0, 'Test 9: Floor price changes must NOT create or modify OHLCV candles');
  assert(allSales.length === 0, 'Test 9: Floor price changes must NOT create sales records');

  console.log('✓ Test 9 passed: Floor price changes do NOT affect OHLCV sales candles');
}

// 10. Independent processing of sale and floor_update
{
  clearFloorState();
  clearMarketState();

  addListing({ listingId: 'l-sale', instrumentKey: 'durov-cap:all:all:TON', price: '100.0', currency: 'TON' });

  // Event A: Completed sale occurs in market engine
  const saleRecord: GiftSale = {
    id: 'sale-100',
    collectionId: 'durov-cap',
    price: '100',
    quantity: '1',
    currency: 'TON',
    eventTime: 1710000000000,
    createdAt: 1710000000000,
    status: 'completed',
  };

  const acceptRes = acceptCompletedSale(saleRecord);
  assert(acceptRes.accepted === true, 'Test 10: Completed sale accepted');

  // Event B: Corresponding listing marked as sold
  const sellRes = sellListing('l-sale');
  assert(sellRes.success === true, 'Test 10: Listing marked as sold');

  // Check state
  const candles = getHistory('durov-cap:all:all:TON', '1m', 0, Date.now() + 10000);
  assert(candles.length === 1, 'Test 10: Exactly 1 sale candle created by acceptCompletedSale');
  assert(candles[0].close === '100', 'Test 10: Candle close is 100');

  const floor = getFloorPrice('durov-cap:all:all:TON');
  assert(floor.floorPrice === null, 'Test 10: Floor price becomes null after single listing sold');

  console.log('✓ Test 10 passed: Sales and floor_update are processed independently');
}

console.log('ALL STAGE 10 TELEGRAM GIFTS FLOOR PRICE TESTS PASSED SUCCESSFULLY!');
