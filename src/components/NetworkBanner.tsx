import { useOnline } from '../hooks/useOnline';
import { useI18n } from '../i18n';
import { Banner } from './ui';

export function NetworkBanner() {
  const online = useOnline();
  const { t } = useI18n();
  if (online !== false) return null;
  return <Banner kind="warning">{t('net.offline')}</Banner>;
}
