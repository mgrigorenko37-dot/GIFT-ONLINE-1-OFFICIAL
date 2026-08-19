import { GiftCandle, GiftSale, Timeframe, msToSeconds } from '../types/market';
import { FormattedChartCandle } from './chartHistory';

export class CandleStore {
  private candlesByStartTime = new Map<number, GiftCandle>();
  public expectedInstrumentKey: string;
  public expectedTimeframe: Timeframe;

  constructor(instrumentKey: string, timeframe: Timeframe) {
    this.expectedInstrumentKey = instrumentKey;
    this.expectedTimeframe = timeframe;
  }

  /**
   * Applies a candle update or closed candle.
   * Returns whether state was updated, and whether it was a new candle.
   */
  public applyCandle(candle: GiftCandle): { updated: boolean; isNew: boolean; conflict?: boolean } {
    if (!candle || typeof candle !== 'object') {
      return { updated: false, isNew: false };
    }

    // Check instrument isolation
    if (candle.instrumentKey && candle.instrumentKey !== this.expectedInstrumentKey) {
      return { updated: false, isNew: false };
    }

    // Check timeframe isolation
    if (candle.timeframe && candle.timeframe !== this.expectedTimeframe) {
      return { updated: false, isNew: false };
    }

    const startTime = candle.startTime;
    if (typeof startTime !== 'number' || startTime <= 0 || !Number.isFinite(startTime)) {
      return { updated: false, isNew: false };
    }

    const existing = this.candlesByStartTime.get(startTime);

    if (!existing) {
      this.candlesByStartTime.set(startTime, candle);
      this.pruneOldCandles();
      return { updated: true, isNew: true };
    }

    // Compare revisions to reject stale updates or duplicates
    const existingRev = existing.revision ?? 0;
    const currentRev = candle.revision ?? 0;

    const existingUpdatedAt = existing.updatedAt ?? 0;
    const currentUpdatedAt = candle.updatedAt ?? 0;

    if (currentRev > existingRev) {
      this.candlesByStartTime.set(startTime, candle);
      return { updated: true, isNew: false };
    } else if (currentRev === existingRev) {
      const isIdentical =
        existing.open === candle.open &&
        existing.high === candle.high &&
        existing.low === candle.low &&
        existing.close === candle.close &&
        existing.volume === candle.volume &&
        existing.tradeCount === candle.tradeCount &&
        existing.confirmed === candle.confirmed;

      if (isIdentical) {
        return { updated: false, isNew: false };
      }

      console.warn(
        `[CandleStore] Revision conflict for startTime ${startTime}: equal revision ${currentRev} with conflicting data.`
      );
      return { updated: false, isNew: false, conflict: true };
    }

    // Stale or duplicate event
    return { updated: false, isNew: false };
  }

  /**
   * Merges an array of candles (e.g. from REST history or snapshot).
   */
  public mergeCandles(candles: GiftCandle[]): number {
    if (!Array.isArray(candles)) return 0;
    let count = 0;
    for (const c of candles) {
      const res = this.applyCandle(c);
      if (res.updated) count++;
    }
    return count;
  }

  /**
   * Returns all candles sorted by startTime ASC.
   */
  public getSortedCandles(): GiftCandle[] {
    return Array.from(this.candlesByStartTime.values()).sort(
      (a, b) => (a.startTime ?? a.time ?? 0) - (b.startTime ?? b.time ?? 0)
    );
  }

  /**
   * Formats candles for Lightweight Charts.
   */
  public getFormattedChartCandles(): FormattedChartCandle[] {
    const sorted = this.getSortedCandles();
    return sorted
      .filter((c) => {
        const o = Number(c.open);
        const h = Number(c.high);
        const l = Number(c.low);
        const cl = Number(c.close);
        if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(cl)) return false;
        // Skip OHLC=0 without tradeCount
        if (o === 0 && h === 0 && l === 0 && cl === 0 && (!c.tradeCount || c.tradeCount === 0))
          return false;
        return true;
      })
      .map((c) => ({
        time: msToSeconds(c.startTime ?? c.time ?? 0) as any,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }));
  }

  public getLatestChartCandle(): FormattedChartCandle | null {
    const formatted = this.getFormattedChartCandles();
    return formatted.length > 0 ? formatted[formatted.length - 1] : null;
  }

  private pruneOldCandles(maxCapacity: number = 5000) {
    if (this.candlesByStartTime.size <= maxCapacity) return;
    const sortedTimes = Array.from(this.candlesByStartTime.keys()).sort((a, b) => a - b);
    const toDeleteCount = this.candlesByStartTime.size - maxCapacity;
    for (let i = 0; i < toDeleteCount; i++) {
      this.candlesByStartTime.delete(sortedTimes[i]);
    }
  }

  public clear() {
    this.candlesByStartTime.clear();
  }
}

export class SequenceTracker {
  private lastSequence: number | null = null;

  public processSequence(
    seq: number,
    isSnapshot: boolean = false
  ): { ok: boolean; gap: boolean; reason?: string } {
    if (typeof seq !== 'number' || !Number.isFinite(seq)) {
      return { ok: false, gap: false, reason: 'invalid_sequence' };
    }

    if (isSnapshot) {
      this.lastSequence = seq;
      return { ok: true, gap: false };
    }

    if (this.lastSequence === null) {
      this.lastSequence = seq;
      return { ok: true, gap: false };
    }

    if (seq <= this.lastSequence) {
      return { ok: false, gap: false, reason: 'stale_sequence' };
    }

    if (seq > this.lastSequence + 1) {
      return { ok: false, gap: true, reason: 'sequence_gap' };
    }

    // Exactly seq === lastSequence + 1
    this.lastSequence = seq;
    return { ok: true, gap: false };
  }

  public getLastSequence(): number | null {
    return this.lastSequence;
  }

  public reset(value: number | null = null) {
    this.lastSequence = value;
  }
}

export class SaleTracker {
  private salesById = new Map<string, GiftSale>();
  public expectedInstrumentKey: string;

  constructor(instrumentKey: string) {
    this.expectedInstrumentKey = instrumentKey;
  }

  public addSale(sale: GiftSale): boolean {
    if (!sale || !sale.id) return false;
    if (sale.instrumentKey && sale.instrumentKey !== this.expectedInstrumentKey) {
      return false;
    }
    if (this.salesById.has(sale.id)) {
      return false; // Duplicate sale
    }
    this.salesById.set(sale.id, sale);
    this.pruneOldSales();
    return true;
  }

  private pruneOldSales(maxCapacity: number = 500) {
    if (this.salesById.size <= maxCapacity) return;
    const sortedSales = Array.from(this.salesById.values()).sort(
      (a, b) => (a.eventTime || 0) - (b.eventTime || 0)
    );
    const toDeleteCount = this.salesById.size - maxCapacity;
    for (let i = 0; i < toDeleteCount; i++) {
      this.salesById.delete(sortedSales[i].id);
    }
  }

  public mergeSales(sales: GiftSale[]): number {
    if (!Array.isArray(sales)) return 0;
    let added = 0;
    for (const s of sales) {
      if (this.addSale(s)) added++;
    }
    return added;
  }

  public getRecentSales(limit: number = 50): GiftSale[] {
    return Array.from(this.salesById.values())
      .sort((a, b) => (b.eventTime || 0) - (a.eventTime || 0))
      .slice(0, limit);
  }

  public clear() {
    this.salesById.clear();
  }
}
