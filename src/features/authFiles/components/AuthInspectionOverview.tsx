import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, type SelectOption } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconActivity, IconRefreshCw, IconTimer, IconTrash2 } from '@/components/ui/icons';
import styles from '@/pages/AuthInspectionPage.module.scss';

type InspectionAction = 'none' | 'delete' | 'disable';

type InspectionState = {
  enabled: boolean;
  running: boolean;
  currentFile: string;
  checked: number;
  valid: number;
  invalid: number;
  skipped: number;
  inconclusive: number;
  deleted: number;
  disabled: number;
  reenabled: number;
  total: number;
  round: number;
  lastError: string;
  lastRunFinished: string;
  reasonCounts: Record<string, number>;
};

type Props = {
  countdownLabel: string;
  disableControls: boolean;
  invalidAction: InspectionAction;
  invalidTotal: number;
  scheduleOptions: SelectOption[];
  scheduleValue: string;
  configDirty: boolean;
  savingConfig: boolean;
  deleting: boolean;
  testing: boolean;
  progressPercent: number;
  autoReenable: boolean;
  inspection: InspectionState;
  onScheduleChange: (value: string) => void;
  onInvalidActionChange: (value: InspectionAction) => void;
  onAutoReenableChange: (value: boolean) => void;
  onSaveConfig: () => void;
  onRunNow: () => void;
  onRunTest: () => void;
  onClearInvalid: () => void;
};

const invalidActionOptions: SelectOption[] = [
  { value: 'none', label: '只检测，不动作' },
  { value: 'delete', label: '发现失效后删除' },
  { value: 'disable', label: '发现失效后禁用' },
];

function formatReasonLabel(reason: string, fallbackLabel: string) {
  switch (reason) {
    case 'missing_chatgpt_account_id':
      return fallbackLabel;
    case 'missing_auth_index':
      return '缺少 auth_index';
    default:
      return reason;
  }
}

export function AuthInspectionOverview({
  countdownLabel,
  disableControls,
  invalidAction,
  invalidTotal,
  scheduleOptions,
  scheduleValue,
  configDirty,
  savingConfig,
  deleting,
  testing,
  progressPercent,
  autoReenable,
  inspection,
  onScheduleChange,
  onInvalidActionChange,
  onAutoReenableChange,
  onSaveConfig,
  onRunNow,
  onRunTest,
  onClearInvalid,
}: Props) {
  const { t } = useTranslation();

  const reasonEntries = useMemo(
    () =>
      Object.entries(inspection.reasonCounts ?? {})
        .filter(([, count]) => Number.isFinite(count) && count > 0)
        .sort((left, right) => right[1] - left[1]),
    [inspection.reasonCounts]
  );

  return (
    <Card
      title={t('auth_inspection.panel_title', { defaultValue: '巡检控制台' })}
      extra={
        <div className={styles.controlBar}>
          <div className={styles.refreshMeta}>
            <IconTimer size={16} />
            <span>
              {inspection.enabled
                ? t('auth_inspection.next_schedule', {
                    defaultValue: '下次自动任务：{{duration}}后',
                    duration: countdownLabel,
                  })
                : t('auth_inspection.schedule_off', { defaultValue: '自动任务已关闭' })}
            </span>
          </div>
          <Select
            value={scheduleValue}
            options={scheduleOptions}
            onChange={onScheduleChange}
            ariaLabel={t('auth_inspection.schedule_label', { defaultValue: '任务频率' })}
            fullWidth={false}
          />
          <Select
            value={invalidAction}
            options={invalidActionOptions}
            onChange={(value) => onInvalidActionChange(value as InspectionAction)}
            ariaLabel={t('auth_inspection.invalid_action', { defaultValue: '失效动作' })}
            fullWidth={false}
          />
          <ToggleSwitch
            checked={autoReenable}
            onChange={onAutoReenableChange}
            label={t('auth_inspection.auto_reenable', { defaultValue: '恢复后自动启用' })}
            disabled={disableControls}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={onSaveConfig}
            disabled={disableControls || !configDirty || savingConfig}
            loading={savingConfig}
          >
            {t('auth_inspection.save_config', { defaultValue: '保存策略' })}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onRunNow}
            disabled={disableControls || inspection.running || deleting || testing}
          >
            <span className={styles.btnInner}>
              <IconRefreshCw size={16} />
              <span>{t('auth_inspection.verify_now', { defaultValue: '立即触发任务' })}</span>
            </span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRunTest}
            disabled={disableControls || inspection.running || deleting || testing}
            loading={testing}
          >
            <span className={styles.btnInner}>
              <IconActivity size={16} />
              <span>{t('auth_inspection.test_run', { defaultValue: '测试执行' })}</span>
            </span>
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onClearInvalid}
            disabled={disableControls || deleting || inspection.running || testing}
            loading={deleting}
          >
            <span className={styles.btnInner}>
              <IconTrash2 size={16} />
              <span>{t('auth_inspection.clear_invalid', { defaultValue: '清理失效' })}</span>
            </span>
          </Button>
        </div>
      }
    >
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('auth_inspection.checked_total', { defaultValue: '已检查凭证' })}</div>
          <div className={styles.summaryValue}>{inspection.checked}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('auth_inspection.current_invalid', { defaultValue: '当前失效 Token' })}</div>
          <div className={`${styles.summaryValue} ${invalidTotal > 0 ? styles.dangerText : ''}`}>{invalidTotal}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('auth_inspection.skipped', { defaultValue: '已跳过' })}</div>
          <div className={styles.summaryValue}>{inspection.skipped}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('auth_inspection.inconclusive', { defaultValue: '待复核' })}</div>
          <div className={styles.summaryValue}>{inspection.inconclusive}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('auth_inspection.disabled', { defaultValue: '本轮禁用' })}</div>
          <div className={styles.summaryValue}>{inspection.disabled}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('auth_inspection.reenabled', { defaultValue: '本轮恢复' })}</div>
          <div className={styles.summaryValue}>{inspection.reenabled}</div>
        </div>
      </div>

      <div className={styles.progressBlock}>
        <div className={styles.progressMeta}>
          <span>{t('auth_inspection.progress', { defaultValue: '巡检进度' })}</span>
          <span>
            {inspection.checked}/{inspection.total || '-'} ({progressPercent}%)
          </span>
        </div>
        <div className={`${styles.progressTrack} ${inspection.running ? styles.progressTrackRunning : ''}`}>
          <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
        </div>
        <div className={styles.progressSubMeta}>
          <span>{t('auth_inspection.round', { defaultValue: '批次' })}: {inspection.round}</span>
          <span>{t('auth_inspection.valid', { defaultValue: '有效' })}: {inspection.valid}</span>
          <span>{t('auth_inspection.invalid', { defaultValue: '失效' })}: {inspection.invalid}</span>
          <span>{t('auth_inspection.skipped', { defaultValue: '已跳过' })}: {inspection.skipped}</span>
          <span>{t('auth_inspection.inconclusive', { defaultValue: '待复核' })}: {inspection.inconclusive}</span>
          <span>{t('auth_inspection.deleted', { defaultValue: '自动清理' })}: {inspection.deleted}</span>
        </div>
        <div className={styles.executionLine}>
          <div className={styles.executionState}>
            <span className={`${styles.stateDot} ${inspection.running ? styles.stateDotRunning : styles.stateDotIdle}`} />
            <span>{inspection.running ? t('auth_inspection.executing', { defaultValue: '任务执行中' }) : t('auth_inspection.idle', { defaultValue: '任务空闲' })}</span>
          </div>
          <div className={`${styles.currentFilePill} ${inspection.running ? styles.currentFilePillRunning : ''}`}>
            {t('auth_inspection.current_file', { defaultValue: '当前处理文件' })}: {inspection.currentFile || '-'}
          </div>
          <div className={styles.executionMeta}>
            {t('auth_inspection.last_run', { defaultValue: '最近完成' })}: {inspection.lastRunFinished || '-'}
          </div>
        </div>
        {inspection.lastError && (
          <div className={styles.errorBox}>
            {t('auth_inspection.last_error', { defaultValue: '最近错误' })}: {inspection.lastError}
          </div>
        )}
      </div>

      {reasonEntries.length > 0 && (
        <div className={styles.trailList}>
          {reasonEntries.map(([reason, count], index) => (
            <div key={reason} className={styles.trailItem}>
              <span className={styles.trailIndex}>#{index + 1} · {count}</span>
              <span className={styles.trailName}>
                {formatReasonLabel(
                  reason,
                  t('auth_inspection.missing_account_id', { defaultValue: '缺少 Chatgpt-Account-Id' })
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
