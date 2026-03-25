import { ActualBudgetTransaction } from './types';

export interface DuplicateInfo {
  isDuplicate: boolean;
  duplicateOf?: string;
  existingTransaction?: ActualBudgetTransaction;
}

// Max days between a pending transaction date and its posted date to still consider it the same transaction.
const PENDING_POST_DATE_WINDOW_DAYS = 5;

export class DuplicateTransactionDetector {
  private existingTransactions: Map<string, ActualBudgetTransaction> = new Map();
  // Index of pending transactions keyed by "{account}_{amount}_{merchantSlug}" for pending→posted matching.
  private pendingByFingerprint: Map<string, ActualBudgetTransaction[]> = new Map();

  constructor(existingTransactions: ActualBudgetTransaction[] = []) {
    this.buildTransactionMap(existingTransactions);
  }

  private buildTransactionMap(transactions: ActualBudgetTransaction[]): void {
    this.existingTransactions.clear();
    this.pendingByFingerprint.clear();

    for (const transaction of transactions) {
      if (transaction.imported_id) {
        this.existingTransactions.set(transaction.imported_id, transaction);
      }

      // Index pending transactions by a fingerprint so we can match them against
      // their posted counterparts even when the date or imported_id has changed.
      if (transaction.notes?.includes('[PENDING]')) {
        const fingerprint = this.pendingFingerprint(transaction.account, transaction.amount, transaction.imported_payee);
        const bucket = this.pendingByFingerprint.get(fingerprint) ?? [];
        bucket.push(transaction);
        this.pendingByFingerprint.set(fingerprint, bucket);
      }
    }
  }

  private pendingFingerprint(account: string, amount: number, payee: string): string {
    const merchantSlug = payee.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
    return `${account}_${amount}_${merchantSlug}`;
  }

  private daysBetween(dateA: string, dateB: string): number {
    const msPerDay = 86400000;
    return Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime()) / msPerDay;
  }

  checkForDuplicates(newTransactions: ActualBudgetTransaction[]): ActualBudgetTransaction[] {
    return newTransactions.map(transaction => {
      const duplicateInfo = this.checkTransaction(transaction);

      return {
        ...transaction,
        isDuplicate: duplicateInfo.isDuplicate,
        duplicateOf: duplicateInfo.duplicateOf,
      };
    });
  }

  private checkTransaction(transaction: ActualBudgetTransaction): DuplicateInfo {
    // Primary check: exact imported_id match.
    if (transaction.imported_id) {
      const existingTransaction = this.existingTransactions.get(transaction.imported_id);
      if (existingTransaction) {
        return {
          isDuplicate: true,
          duplicateOf: existingTransaction.id,
          existingTransaction,
        };
      }
    }

    // Secondary check: pending→posted reconciliation.
    // A posted transaction (no [PENDING] in notes) may correspond to an existing pending
    // transaction whose imported_id and date have both changed upon settlement.
    // Match by account + amount + merchant within a date window.
    if (!transaction.notes?.includes('[PENDING]')) {
      const fingerprint = this.pendingFingerprint(transaction.account, transaction.amount, transaction.imported_payee);
      const candidates = this.pendingByFingerprint.get(fingerprint);
      if (candidates) {
        const match = candidates.find(
          existing => this.daysBetween(existing.date, transaction.date) <= PENDING_POST_DATE_WINDOW_DAYS
        );
        if (match) {
          return {
            isDuplicate: true,
            duplicateOf: match.id,
            existingTransaction: match,
          };
        }
      }
    }

    return { isDuplicate: false };
  }

  getDuplicateCount(transactions: ActualBudgetTransaction[]): number {
    return transactions.filter(t => t.isDuplicate).length;
  }

  getUniqueTransactions(transactions: ActualBudgetTransaction[]): ActualBudgetTransaction[] {
    return transactions.filter(t => !t.isDuplicate);
  }

  getDuplicateTransactions(transactions: ActualBudgetTransaction[]): ActualBudgetTransaction[] {
    return transactions.filter(t => t.isDuplicate);
  }
}
