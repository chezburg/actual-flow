import { ActualBudgetTransaction } from './types';

export interface DuplicateInfo {
  isDuplicate: boolean;
  duplicateOf?: string;
  existingTransaction?: ActualBudgetTransaction;
}

export class DuplicateTransactionDetector {
  private existingTransactions: Map<string, ActualBudgetTransaction> = new Map();

  constructor(existingTransactions: ActualBudgetTransaction[] = []) {
    this.buildTransactionMap(existingTransactions);
  }

  private buildTransactionMap(transactions: ActualBudgetTransaction[]): void {
    this.existingTransactions.clear();
    
    for (const transaction of transactions) {
      // Use imported_id as the primary key for duplicate detection
      if (transaction.imported_id) {
        this.existingTransactions.set(transaction.imported_id, transaction);
      }
    }
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
    // First check by imported_id if available
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

    // Fallback: check for pending->cleared duplicates by matching date + amount
    // This catches cases where imported_id changes when a pending transaction clears
    const matchingTransaction = this.findMatchingTransaction(transaction);
    if (matchingTransaction) {
      return {
        isDuplicate: true,
        duplicateOf: matchingTransaction.id,
        existingTransaction: matchingTransaction,
      };
    }

    return { isDuplicate: false };
  }

  private findMatchingTransaction(transaction: ActualBudgetTransaction): ActualBudgetTransaction | undefined {
    // Look for transactions with same date and amount (within a small window for pending->cleared transitions)
    for (const existing of this.existingTransactions.values()) {
      // Skip if already matched by imported_id
      if (transaction.imported_id && existing.imported_id === transaction.imported_id) {
        continue;
      }

      // Match on date and amount
      const dateMatch = existing.date === transaction.date;
      const amountMatch = existing.amount === transaction.amount;

      if (dateMatch && amountMatch) {
        // Check for pending->cleared transition by looking for [PENDING] in existing transaction
        const existingHasPending = existing.payee_name?.includes('[PENDING]') ||
                                   existing.notes?.includes('[PENDING]');
        const newHasPending = transaction.payee_name?.includes('[PENDING]') ||
                             transaction.notes?.includes('[PENDING]');

        // If existing has [PENDING] and new doesn't, it's likely a cleared version
        if (existingHasPending && !newHasPending) {
          // Strip [PENDING] from existing payee name and compare
          const existingPayeeStripped = existing.payee_name?.replace('[PENDING] ', '').trim();
          const newPayee = transaction.payee_name?.trim();

          if (existingPayeeStripped && newPayee) {
            if (existingPayeeStripped === newPayee) {
              return existing;
            }
          } else {
            // If payee names not available, date + amount match is sufficient
            return existing;
          }
        }

        // Additional check: payee should be similar (if both have payee names)
        if (existing.payee_name && transaction.payee_name) {
          const payeeMatch = existing.payee_name === transaction.payee_name;
          if (payeeMatch) {
            return existing;
          }
        } else {
          // If one or both don't have payee names, date + amount is enough
          return existing;
        }
      }
    }

    return undefined;
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
