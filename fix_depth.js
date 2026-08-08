const fs = require('fs');
let content = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// The original strings to replace:
const originalAsks = `{orderBook.asks.slice(0, 15).map((ask) => {
                  const total = (Number(ask.price) * Number(ask.amount)).toFixed(2);
                  const depthPercent = (Number(ask.amount) / maxAskAmount) * 100;`;

const newAsks = `{(() => {
                  let cumulativeAsk = 0;
                  const totalAskVol = orderBook.asks.slice(0, 15).reduce((sum, a) => sum + Number(a.amount), 0);
                  return orderBook.asks.slice(0, 15).map((ask) => {
                    const total = (Number(ask.price) * Number(ask.amount)).toFixed(2);
                    cumulativeAsk += Number(ask.amount);
                    const depthPercent = totalAskVol > 0 ? (cumulativeAsk / totalAskVol) * 100 : 0;`;

content = content.replace(originalAsks, newAsks);

const originalAsksEnd = `                  );
                })}`;

const newAsksEnd = `                  );
                  });
                })()}`;

content = content.replace(originalAsksEnd, newAsksEnd);

const originalBids = `{orderBook.bids.slice(0, 15).map((bid) => {
                  const total = (Number(bid.price) * Number(bid.amount)).toFixed(2);
                  const depthPercent = (Number(bid.amount) / maxBidAmount) * 100;`;

const newBids = `{(() => {
                  let cumulativeBid = 0;
                  const totalBidVol = orderBook.bids.slice(0, 15).reduce((sum, a) => sum + Number(a.amount), 0);
                  return orderBook.bids.slice(0, 15).map((bid) => {
                    const total = (Number(bid.price) * Number(bid.amount)).toFixed(2);
                    cumulativeBid += Number(bid.amount);
                    const depthPercent = totalBidVol > 0 ? (cumulativeBid / totalBidVol) * 100 : 0;`;

content = content.replace(originalBids, newBids);
content = content.replace(originalAsksEnd, newAsksEnd); // The end is the same structure

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', content);
