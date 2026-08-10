import { totalUsd } from './balances';
import { accounts, usdToEur } from './state';

export const displayedTotal = accounts.currency === 'EUR' ? totalUsd * usdToEur : totalUsd;
