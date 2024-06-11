declare module "@actual-app/api" {
  export function init(config: { serverURL: string; dataDir: string; password: string }): Promise<void>;
  export function shutdown(): Promise<void>;

  export function downloadBudget(budgetId: string): Promise<void>;

  export const utils: Utils;
  interface Utils {
    amountToInteger(amount: number): number;
    integerToAmount(amount: number): number;
  }

  /************************************************************************************************
   * Account -  https://actualbudget.org/docs/api/reference#transactions
   ***********************************************************************************************/
  export interface Account {
    id?: string;
    name: string;
    type: "checking" | "credit" | "savings" | "investment" | "mortgage" | "debt" | "other";
    offbudget?: boolean;
    closed?: boolean;
  }

  export function getAccounts(): Promise<Account[]>;
  export function createAccount(account: Account, initialBalance: number): Promise<string>;
  export function updateAccount(id: string, account: Partial<Account>): Promise<void>;
  export function deleteAccount(id: string): Promise<void>;

  /************************************************************************************************
   * Transaction -  https://actualbudget.org/docs/api/reference#transactions
   ***********************************************************************************************/
  export interface Transaction {
    id?: string;
    account: string;
    date: Date;
    amount?: number;
    payee?: string;
    payee_name?: string;
    imported_payee?: string;
    category?: string;
    notes?: string;
    imported_id?: string | number;
    transfer_id?: string;
    cleared?: boolean;
    subtrensactions?: Transaction[];
  }

  export function addTransactions(
    accountId: string,
    transactions: Transaction[],
    runTransfers?: boolean,
    learnCategories?: boolean
  ): Promise<string[]>;

  export function importTransactions(
    accountId: string,
    transactions: Transaction[]
  ): Promise<{ errors: string[]; updated: string[]; added: string[] }>;

  export function getTransactions(accountId: string, startDate: string, endDate: string): Promise<Transaction[]>;

  /************************************************************************************************
   * Queries -  https://actualbudget.org/docs/api/reference#queries
   ***********************************************************************************************/

  export type ChainableQuery = {
    filter: (filter: any) => ChainableQuery;
    sort: (sort: string) => ChainableQuery;
    limit: (limit: number) => ChainableQuery;
    select: (select: string) => ChainableQuery;
  };
  export function runQuery(query: string | ChainableQuery): Promise<any>;
  export function q(query: string): ChainableQuery;
}
