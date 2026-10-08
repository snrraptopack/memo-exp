import type { RowWriteFacts } from '../handlers/write-facts';

/** DOM row ABI allocated after shared source/write analysis. */
export interface RowCtx extends Omit<RowWriteFacts, 'localRefresh'> {
  rowIdVar: string;
  refreshVar?: string;
  ownerIdVar?: string;
}
