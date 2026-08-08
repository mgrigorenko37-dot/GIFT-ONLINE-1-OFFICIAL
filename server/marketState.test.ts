import { processSale, activeCandles, closedCandles, allSales } from './marketState';
import { GiftSale } from './chartEngine';

const testSale1: GiftSale = {
  id: "s1",
  collectionId: "coll1",
  price: "100",
  quantity: "1",
  currency: "TON",
  eventTime: 1710000000000,
  createdAt: 1710000000000,
  status: "completed"
};

const testSale2: GiftSale = {
  id: "s2",
  collectionId: "coll1",
  price: "105",
  quantity: "2",
  currency: "TON",
  eventTime: 1710000010000, // +10s
  createdAt: 1710000010000,
  status: "completed"
};

const testSale3: GiftSale = {
  id: "s3",
  collectionId: "coll1",
  price: "110",
  quantity: "1",
  currency: "TON",
  eventTime: 1710000070000, // +1m 10s -> next minute candle
  createdAt: 1710000070000,
  status: "completed"
};

const testLateSale: GiftSale = {
  id: "s4_late",
  collectionId: "coll1",
  price: "90",
  quantity: "1",
  currency: "TON",
  eventTime: 1710000005000, // Late but in first minute
  createdAt: 1710000080000,
  status: "completed"
};

processSale(testSale1);
processSale(testSale2);
processSale(testSale3);
processSale(testLateSale);

const ik = "coll1:any:any:TON";
console.log("1m Closed:", closedCandles[ik]["1m"]);
console.log("1m Active:", activeCandles[ik]["1m"]);

