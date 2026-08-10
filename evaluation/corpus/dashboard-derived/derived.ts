import { refunds, sales } from './state';

export const gross = sales * 25;
export const loss = refunds * 25;
