import { processSale } from "./marketState";
import { GiftSale } from "./chartEngine";

export function simulateSales(io: any) {
  // Simulate some sales for the UI to show
  setInterval(() => {
    const sale: GiftSale = {
      id: Math.random().toString(36).substring(7),
      collectionId: "durov-cap", // Example hardcoded collection
      price: (124 + Math.random() * 5 - 2.5).toFixed(2), // around 124
      quantity: "1",
      currency: "TON",
      eventTime: Date.now(),
      createdAt: Date.now(),
      status: "completed"
    };

    const updatedCandles = processSale(sale);
    
    if (updatedCandles) {
      // Broadcast to clients in this room
      const instrumentKey = `durov-cap:any:any:TON`;
      const room = `market_${instrumentKey}`;
      
      // Send individual sale event
      io.to(room).emit('market_event', {
        type: 'sale',
        sequence: Date.now(),
        sale
      });
      
      // Send updated candles
      updatedCandles.forEach(candle => {
        io.to(room).emit('market_event', {
           type: 'candle_update',
           sequence: Date.now() + 1,
           instrumentKey,
           timeframe: candle.timeframe,
           candle
        });
      });
    }
  }, 15000); // every 15s
}
