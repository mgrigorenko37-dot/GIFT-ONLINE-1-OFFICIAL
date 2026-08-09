import { IMarketRepository, OutboxEvent } from './marketRepository';
import { broadcastSaleResult, broadcastFloorResult } from './realtimeManager';
import { AcceptSaleResult } from './marketState';

export class OutboxWorker {
  private repo: IMarketRepository;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private pollIntervalMs: number;
  private isProcessing = false;

  constructor(repo: IMarketRepository, pollIntervalMs = 100) {
    this.repo = repo;
    this.pollIntervalMs = pollIntervalMs;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  private scheduleNext() {
    if (!this.isRunning) return;
    this.intervalId = setTimeout(async () => {
      await this.processPendingEvents();
      this.scheduleNext();
    }, this.pollIntervalMs);
  }

  public async triggerImmediateProcessing(): Promise<number> {
    return await this.processPendingEvents();
  }

  public async processPendingEvents(): Promise<number> {
    if (this.isProcessing) return 0;
    if (!this.repo.fetchPendingOutboxEvents) return 0;

    this.isProcessing = true;
    let processedCount = 0;

    try {
      const events = await this.repo.fetchPendingOutboxEvents(50, 30000);
      for (const evt of events) {
        try {
          await this.dispatchOutboxEvent(evt);
          if (this.repo.markOutboxEventPublished) {
            await this.repo.markOutboxEventPublished(evt.eventId);
          }
          processedCount++;
        } catch (err: any) {
          console.error(`[OutboxWorker] Failed to publish outbox event ${evt.eventId}:`, err);
          if (this.repo.markOutboxEventFailed) {
            const backoffMs = Math.min(1000 * Math.pow(2, evt.attempts || 1), 60000);
            const nextAvail = Date.now() + backoffMs;
            await this.repo.markOutboxEventFailed(evt.eventId, err.message || String(err), nextAvail);
          }
        }
      }
    } catch (err) {
      console.error('[OutboxWorker] Error during poll execution:', err);
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  private async dispatchOutboxEvent(evt: OutboxEvent): Promise<void> {
    if (evt.eventType === 'sale_accepted' && evt.payload) {
      const result: AcceptSaleResult = {
        accepted: true,
        reason: 'accepted',
        sale: evt.payload.sale,
        dedupeKey: evt.aggregateId,
        candles: evt.payload.candles,
        candleEvents: evt.payload.candleEvents,
      };
      await broadcastSaleResult(result);
    } else if (evt.eventType === 'floor_updated' && evt.payload) {
      await broadcastFloorResult(evt.payload.floorResult);
    }
  }
}

let globalOutboxWorker: OutboxWorker | null = null;

export function getOutboxWorker(repo?: IMarketRepository): OutboxWorker | null {
  if (!globalOutboxWorker && repo) {
    globalOutboxWorker = new OutboxWorker(repo);
  }
  return globalOutboxWorker;
}

export function initOutboxWorker(repo: IMarketRepository): OutboxWorker {
  if (globalOutboxWorker) {
    globalOutboxWorker.stop();
  }
  globalOutboxWorker = new OutboxWorker(repo);
  globalOutboxWorker.start();
  return globalOutboxWorker;
}

export function stopOutboxWorker() {
  if (globalOutboxWorker) {
    globalOutboxWorker.stop();
    globalOutboxWorker = null;
  }
}
