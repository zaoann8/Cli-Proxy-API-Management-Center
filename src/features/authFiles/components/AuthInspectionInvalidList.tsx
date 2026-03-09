import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { IconTimer } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import styles from '@/pages/AuthInspectionPage.module.scss';

type Props = {
  invalidFiles: AuthFileItem[];
  invalidLoading: boolean;
  invalidPage: number;
  invalidTotal: number;
  totalInvalidPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  formatInvalidMeta: (item: AuthFileItem) => string;
};

export function AuthInspectionInvalidList({
  invalidFiles,
  invalidLoading,
  invalidPage,
  invalidTotal,
  totalInvalidPages,
  onPrevPage,
  onNextPage,
  formatInvalidMeta,
}: Props) {
  const { t } = useTranslation();

  return (
    <Card
      title={t('auth_inspection.invalid_list_title', { defaultValue: '失效 Token 列表' })}
      extra={
        <div className={styles.controlBar}>
          <div className={styles.refreshMeta}>
            <IconTimer size={16} />
            <span>
              {t('auth_inspection.invalid_page_meta', {
                defaultValue: '共 {{total}} 条，第 {{page}} / {{pages}} 页',
                total: invalidTotal,
                page: invalidPage,
                pages: totalInvalidPages,
              })}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onPrevPage}
            disabled={invalidPage <= 1 || invalidLoading}
          >
            {t('common.previous', { defaultValue: '上一页' })}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onNextPage}
            disabled={invalidPage >= totalInvalidPages || invalidLoading}
          >
            {t('common.next', { defaultValue: '下一页' })}
          </Button>
        </div>
      }
    >
      {invalidLoading && invalidFiles.length === 0 ? (
        <div className={styles.emptyText}>
          {t('common.loading', { defaultValue: '加载中...' })}
        </div>
      ) : invalidFiles.length === 0 ? (
        <div className={styles.emptyText}>
          {t('auth_inspection.invalid_empty', { defaultValue: '当前没有已标记失效的 Codex Token。' })}
        </div>
      ) : (
        <div className={styles.reasonList}>
          {invalidFiles.map((item) => (
            <div key={item.name} className={styles.reasonRow}>
              <span className={styles.reasonName}>{item.name}</span>
              <span className={styles.reasonText}>{formatInvalidMeta(item)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
