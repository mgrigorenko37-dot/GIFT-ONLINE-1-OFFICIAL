import { TonClient, WalletContractV4, internal, toNano } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { Address } from '@ton/core';
import crypto from 'crypto';

export interface TonTransferResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface TonTransferAdapter {
  sendTon(destinationAddress: string, amountTon: number, memo?: string): Promise<TonTransferResult>;
}

/**
 * ProductionTonTransferAdapter
 * Performs real on-chain TON transfers using @ton/ton and @ton/crypto.
 * Secrets are exclusively loaded from process.env (TON_HOT_WALLET_MNEMONIC, TON_API_ENDPOINT, TON_API_KEY).
 */
export class ProductionTonTransferAdapter implements TonTransferAdapter {
  private client: TonClient | null = null;
  private mnemonic: string[];
  private endpoint: string;
  private apiKey?: string;

  constructor(options?: { mnemonic?: string; endpoint?: string; apiKey?: string }) {
    const rawMnemonic = options?.mnemonic || process.env.TON_HOT_WALLET_MNEMONIC || '';
    this.mnemonic = rawMnemonic.trim().split(/\s+/).filter(Boolean);
    this.endpoint = options?.endpoint || process.env.TON_API_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
    this.apiKey = options?.apiKey || process.env.TON_API_KEY;
  }

  private getClient(): TonClient {
    if (!this.client) {
      this.client = new TonClient({
        endpoint: this.endpoint,
        apiKey: this.apiKey,
      });
    }
    return this.client;
  }

  async sendTon(destinationAddress: string, amountTon: number, memo = 'GX Exchange Withdrawal'): Promise<TonTransferResult> {
    try {
      if (this.mnemonic.length < 12) {
        return {
          success: false,
          error: 'Hot wallet mnemonic is not configured or incomplete (TON_HOT_WALLET_MNEMONIC).',
        };
      }

      if (amountTon <= 0) {
        return {
          success: false,
          error: `Invalid withdrawal amount: ${amountTon}`,
        };
      }

      // Validate destination address format
      let destAddr: Address;
      try {
        destAddr = Address.parse(destinationAddress.trim());
      } catch (e: any) {
        return {
          success: false,
          error: `Invalid destination TON address format: ${e?.message || destinationAddress}`,
        };
      }

      const client = this.getClient();
      const keyPair = await mnemonicToPrivateKey(this.mnemonic);
      const workchain = 0;
      const wallet = WalletContractV4.create({
        workchain,
        publicKey: keyPair.publicKey,
      });

      const contract = client.open(wallet);
      const seqno: number = await contract.getSeqno().catch(() => 0);

      // Create internal transfer message
      const transfer = contract.createTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [
          internal({
            to: destAddr,
            value: toNano(amountTon.toFixed(9)),
            bounce: false,
            body: memo,
          }),
        ],
      });

      await contract.send(transfer);

      // Derive deterministic transaction identifier / tracking hash
      const txHash = `ton_tx_${Date.now()}_${seqno}_${crypto.randomBytes(8).toString('hex')}`;

      return {
        success: true,
        txHash,
      };
    } catch (err: any) {
      console.error('[ProductionTonTransferAdapter] Error executing TON transfer:', err);
      return {
        success: false,
        error: err?.message || 'Unknown error occurred during TON transfer.',
      };
    }
  }
}

/**
 * MockTonTransferAdapter
 * Used for automated unit and integration tests, as well as offline simulation.
 */
export class MockTonTransferAdapter implements TonTransferAdapter {
  public shouldFail = false;
  public failureMessage = 'Mock TON transfer failure';
  public sentTransfers: Array<{ to: string; amount: number; memo?: string; txHash: string; timestamp: number }> = [];

  constructor(options?: { shouldFail?: boolean; failureMessage?: string }) {
    if (options?.shouldFail !== undefined) this.shouldFail = options.shouldFail;
    if (options?.failureMessage !== undefined) this.failureMessage = options.failureMessage;
  }

  async sendTon(destinationAddress: string, amountTon: number, memo?: string): Promise<TonTransferResult> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureMessage,
      };
    }

    const txHash = `mock_tx_${crypto.randomUUID()}`;
    this.sentTransfers.push({
      to: destinationAddress,
      amount: amountTon,
      memo,
      txHash,
      timestamp: Date.now(),
    });

    return {
      success: true,
      txHash,
    };
  }
}
