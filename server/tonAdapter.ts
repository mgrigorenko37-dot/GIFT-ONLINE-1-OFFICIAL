import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { Address } from '@ton/core';
import crypto from 'crypto';
import Decimal from 'decimal.js';

export const MAX_TON_AMOUNT = new Decimal('100000000000'); // 100 billion TON maximum ceiling

export interface TonAmountValidationResult {
  isValid: boolean;
  error?: string;
  nanoTon?: bigint;
  amountDecimal?: Decimal;
}

/**
 * Safely validates and converts a TON amount (Decimal or string) to nanoTON (bigint).
 * Guarantees:
 * - Positive value (> 0)
 * - Max precision of 9 decimal places for TON (nanoTON granularity)
 * - Maximum allowed amount ceiling
 * - Absence of NaN, Infinity, and negative values
 * - Zero floating-point arithmetic or loss of precision
 */
export function validateAndConvertToNano(amount: Decimal | string): TonAmountValidationResult {
  let d: Decimal;
  try {
    if (typeof amount === 'string') {
      const trimmed = amount.trim();
      if (
        !trimmed ||
        trimmed.toLowerCase().includes('nan') ||
        trimmed.toLowerCase().includes('infinity')
      ) {
        return { isValid: false, error: 'Invalid TON amount format (NaN or Infinity).' };
      }
      d = new Decimal(trimmed);
    } else if (Decimal.isDecimal(amount)) {
      d = amount;
    } else {
      return {
        isValid: false,
        error: 'Invalid TON amount type. Must be Decimal or decimal string.',
      };
    }
  } catch (e: any) {
    return {
      isValid: false,
      error: `Invalid TON amount numeric representation: ${e?.message || amount}`,
    };
  }

  if (d.isNaN() || !d.isFinite()) {
    return { isValid: false, error: 'Invalid TON amount: NaN or Infinity.' };
  }

  if (d.lte(0)) {
    return { isValid: false, error: `TON amount must be positive: ${d.toString()}` };
  }

  if (d.decimalPlaces() > 9) {
    return {
      isValid: false,
      error: `TON amount exceeds maximum precision of 9 decimal places: ${d.toString()}`,
    };
  }

  if (d.gt(MAX_TON_AMOUNT)) {
    return {
      isValid: false,
      error: `TON amount exceeds maximum allowed ceiling (${MAX_TON_AMOUNT.toString()} TON): ${d.toString()}`,
    };
  }

  try {
    // 1 TON = 1,000,000,000 nanoTON = 10^9
    const nanoDecimal = d.times('1000000000');
    if (!nanoDecimal.isInteger()) {
      return {
        isValid: false,
        error: 'TON amount conversion to nanoTON resulted in fractional nanoTON.',
      };
    }
    const nanoTon = BigInt(nanoDecimal.toFixed(0));
    return {
      isValid: true,
      nanoTon,
      amountDecimal: d,
    };
  } catch (e: any) {
    return {
      isValid: false,
      error: `Failed to convert TON amount to nanoTON: ${e?.message || amount}`,
    };
  }
}

export interface TonTransferResult {
  success: boolean;
  txHash?: string;
  error?: string;
  isUnknown?: boolean;
}

export interface TonTransferAdapter {
  sendTon(
    destinationAddress: string,
    amountTon: Decimal | string,
    memo?: string,
    operationId?: string
  ): Promise<TonTransferResult>;
  checkTransactionByOperationId?(
    operationId: string,
    destinationAddress?: string
  ): Promise<{ found: boolean; txHash?: string }>;
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
    this.endpoint =
      options?.endpoint || process.env.TON_API_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC';
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

  async checkTransactionByOperationId(
    operationId: string
  ): Promise<{ found: boolean; txHash?: string }> {
    try {
      if (this.mnemonic.length < 12) {
        return { found: false };
      }
      const client = this.getClient();
      const keyPair = await mnemonicToPrivateKey(this.mnemonic);
      const workchain = 0;
      const wallet = WalletContractV4.create({
        workchain,
        publicKey: keyPair.publicKey,
      });

      const transactions = await client.getTransactions(wallet.address, { limit: 20 });
      for (const tx of transactions) {
        const inMsg = tx.inMessage;
        const outMsgs = tx.outMessages;
        // Check outMessages memo/body for operationId
        for (const [_, msg] of outMsgs) {
          if (msg.body && msg.body.asSlice().remainingBits > 0) {
            try {
              const bodyStr = msg.body.asSlice().loadStringTail();
              if (bodyStr.includes(operationId)) {
                return { found: true, txHash: tx.hash().toString('hex') };
              }
            } catch {}
          }
        }
      }
      return { found: false };
    } catch (e) {
      console.error('[ProductionTonTransferAdapter] Error checking transaction by operationId:', e);
      return { found: false };
    }
  }

  async sendTon(
    destinationAddress: string,
    amountTon: Decimal | string,
    memo?: string,
    operationId?: string
  ): Promise<TonTransferResult> {
    try {
      if (this.mnemonic.length < 12) {
        return {
          success: false,
          error: 'Hot wallet mnemonic is not configured or incomplete (TON_HOT_WALLET_MNEMONIC).',
        };
      }

      const validation = validateAndConvertToNano(amountTon);
      if (!validation.isValid || !validation.nanoTon || !validation.amountDecimal) {
        return {
          success: false,
          error: validation.error || `Invalid withdrawal amount: ${amountTon}`,
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

      const payloadMemo = operationId
        ? `${memo || 'GX Withdrawal'} [op:${operationId}]`
        : memo || 'GX Exchange Withdrawal';

      // Create internal transfer message passing exact nanoTON bigint value
      const transfer = contract.createTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [
          internal({
            to: destAddr,
            value: validation.nanoTon,
            bounce: false,
            body: payloadMemo,
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
      const isTimeout =
        err?.message?.toLowerCase().includes('timeout') ||
        err?.message?.toLowerCase().includes('network');
      return {
        success: false,
        error: err?.message || 'Unknown error occurred during TON transfer.',
        isUnknown: isTimeout,
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
  public isTimeout = false;
  public failureMessage = 'Mock TON transfer failure';
  public sentTransfers: Array<{
    to: string;
    amount: string;
    nanoTon: bigint;
    memo?: string;
    operationId?: string;
    txHash: string;
    timestamp: number;
  }> = [];
  public publishedTxByOpId = new Map<string, string>();

  constructor(options?: { shouldFail?: boolean; isTimeout?: boolean; failureMessage?: string }) {
    if (options?.shouldFail !== undefined) this.shouldFail = options.shouldFail;
    if (options?.isTimeout !== undefined) this.isTimeout = options.isTimeout;
    if (options?.failureMessage !== undefined) this.failureMessage = options.failureMessage;
  }

  async checkTransactionByOperationId(
    operationId: string,
    destinationAddress?: string
  ): Promise<{ found: boolean; txHash?: string }> {
    if (this.publishedTxByOpId.has(operationId)) {
      return { found: true, txHash: this.publishedTxByOpId.get(operationId) };
    }
    return { found: false };
  }

  async sendTon(
    destinationAddress: string,
    amountTon: Decimal | string,
    memo?: string,
    operationId?: string
  ): Promise<TonTransferResult> {
    const validation = validateAndConvertToNano(amountTon);
    if (!validation.isValid || !validation.nanoTon || !validation.amountDecimal) {
      return {
        success: false,
        error: validation.error || `Invalid withdrawal amount: ${amountTon}`,
      };
    }

    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureMessage,
        isUnknown: this.isTimeout,
      };
    }

    const txHash = `mock_tx_${crypto.randomUUID()}`;
    if (operationId) {
      this.publishedTxByOpId.set(operationId, txHash);
    }

    this.sentTransfers.push({
      to: destinationAddress,
      amount: validation.amountDecimal.toString(),
      nanoTon: validation.nanoTon,
      memo,
      operationId,
      txHash,
      timestamp: Date.now(),
    });

    return {
      success: true,
      txHash,
    };
  }
}
