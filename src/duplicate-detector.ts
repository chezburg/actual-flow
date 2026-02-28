import { ActualBudgetTransaction } from './types';

export interface DuplicateInfo {
  isDuplicate: boolean;
  duplicateOf?: string;
  existingTransaction?: ActualBudgetTransaction;
  shouldReplace?: boolean; // Indicates if the new transaction should replace the existing one
}

export class DuplicateTransactionDetector {
  private existingTransactions: Map<string, ActualBudgetTransaction> = new Map();
  private pendingTransactionsByKey: Map<string, ActualBudgetTransaction> = new Map();

  constructor(existingTransactions: ActualBudgetTransaction[] = []) {
    this.buildTransactionMap(existingTransactions);
  }

  private buildTransactionMap(transactions: ActualBudgetTransaction[]): void {
    this.existingTransactions.clear();
    this.pendingTransactionsByKey.clear();
    
    for (const transaction of transactions) {
      // Use imported_id as the primary key for duplicate detection
      if (transaction.imported_id) {
        this.existingTransactions.set(transaction.imported_id, transaction);
        
        // If this is a pending transaction, also index it by its synthetic key
        if (this.isPendingImportedId(transaction.imported_id)) {
          const syntheticKey = this.extractSyntheticKey(transaction.imported_id);
          if (syntheticKey) {
            this.pendingTransactionsByKey.set(syntheticKey, transaction);
          }
        }
      }
    }
  }

  /**
   * Check if an imported_id is from a pending transaction
   */
  private isPendingImportedId(importedId: string): boolean {
    return importedId.startsWith('lf_pending_');
  }

  /**
   * Extract the synthetic key from a pending transaction's imported_id
   * Format: lf_pending_{accountId}_{date}_{amountCents}_{merchantSlug}
   * Returns: {accountId}_{date}_{amountCents}_{merchantSlug}
   */
  private extractSyntheticKey(pendingImportedId: string): string | null {
    if (!this.isPendingImportedId(pendingImportedId)) {
      return null;
    }
    return pendingImportedId.replace('lf_pending_', '');
  }

  /**
   * Generate synthetic key from a posted transaction to match against pending transactions
   */
  private generateSyntheticKeyFromTransaction(transaction: ActualBudgetTransaction): string | null {
    if (!transaction.imported_id || !transaction.imported_id.startsWith('lf_')) {
      return null;
    }
    
    // Extract account ID from imported_id (lf_{id})
    // We need to reconstruct the key from transaction data
    // This assumes we have access to the original account and merchant info in notes/payee
    const amountCents = transaction.amount;
    const merchantSlug = transaction.payee_name
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20) || '';
    
    // We can't reliably extract the account ID from a posted transaction's imported_id
    // So we need to match by comparing the transaction attributes directly
    return null;
  }

  checkForDuplicates(newTransactions: ActualBudgetTransaction[]): ActualBudgetTransaction[] {
    return newTransactions.map(transaction => {
      const duplicateInfo = this.checkTransaction(transaction);
      
      return {
        ...transaction,
        isDuplicate: duplicateInfo.isDuplicate,
        duplicateOf: duplicateInfo.duplicateOf,
        shouldReplace: duplicateInfo.shouldReplace,
      };
    });
  }

  private checkTransaction(transaction: ActualBudgetTransaction): DuplicateInfo {
    if (!transaction.imported_id) {
      return { isDuplicate: false };
    }

    // First check for exact imported_id match
    const exactMatch = this.existingTransactions.get(transaction.imported_id);
    
    if (exactMatch) {
      return {
        isDuplicate: true,
        duplicateOf: exactMatch.id,
        existingTransaction: exactMatch,
        shouldReplace: false,
      };
    }

    // If this is a posted transaction (not pending), check if there's a matching pending transaction
    if (!this.isPendingImportedId(transaction.imported_id)) {
      const matchingPending = this.findMatchingPendingTransaction(transaction);
      
      if (matchingPending) {
        return {
          isDuplicate: true,
          duplicateOf: matchingPending.id,
          existingTransaction: matchingPending,
          shouldReplace: true, // Posted transaction should replace pending
        };
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Find a pending transaction that matches a posted transaction by key attributes
   */
  private findMatchingPendingTransaction(postedTransaction: ActualBudgetTransaction): ActualBudgetTransaction | null {
    // Look through all pending transactions and find one that matches
    for (const [key, pendingTx] of this.pendingTransactionsByKey.entries()) {
      if (this.transactionsMatch(postedTransaction, pendingTx)) {
        return pendingTx;
      }
    }
    return null;
  }

  /**
   * Check if two transactions match by their key attributes
   */
  private transactionsMatch(tx1: ActualBudgetTransaction, tx2: ActualBudgetTransaction): boolean {
    return (
      tx1.account === tx2.account &&
      tx1.date === tx2.date &&
      tx1.amount === tx2.amount &&
      tx1.payee_name === tx2.payee_name
    );
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
