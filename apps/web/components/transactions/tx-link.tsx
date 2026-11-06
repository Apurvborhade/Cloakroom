import { appConfig } from '@/lib/config';
import { explorerTxUrl } from '@/lib/format/address';
import { Address } from '../ui/address';

export function TxLink({ hash }: { hash: string }) {
  return <Address value={hash} head={10} tail={8} href={explorerTxUrl(appConfig.explorerUrl, hash)} />;
}
