import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select, type SelectOption } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconActivity, IconRefreshCw, IconTimer, IconTrash2 } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { authFilesApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import styles from './AuthInspectionPage.module.scss';

type InspectionState = {
  enabled: boolean;
  intervalSeconds: number;
  autoDeleteInvalid: boolean;
  running: boolean;
  trigger: string;
  currentFile: string;
  recentChecked: string[];
  checked: number;
  valid: number;
  invalid: number;
  deleted: number;
  total: number;
  round: number;
  lastError: string;
  lastRunStartedAt: string;
  lastRunFinished: string;
  nextRunAt: string;
};

const scheduleOptions: SelectOption[] = [
  { value: 'off', label: '关闭自动任务' },
  { value: '3600', label: '每 1 小时' },
  { value: '10800', label: '每 3 小时' },
  { value: '21600', label: '每 6 小时' },
  { value: '43200', label: '每 12 小时' },
  { value: '86400', label: '每 24 小时' },
];

const toBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'yes' || text === 'on';
  }
  return false;
};

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toText = (value: unknown): string => String(value ?? '').trim();

const defaultInspectionState: InspectionState = {
  enabled: false,
  intervalSeconds: 3600,
  autoDeleteInvalid: false,
  running: false,
  trigger: '',
  currentFile: '',
  recentChecked: [],
  checked: 0,
  valid: 0,
  invalid: 0,
  deleted: 0,
  total: 0,
  round: 0,
  lastError: '',
  lastRunStartedAt: '',
  lastRunFinished: '',
  nextRunAt: '',
};

const normalizeInspectionState = (raw: unknown): InspectionState => {
  const data = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    enabled: toBool(data.enabled),
    intervalSeconds: Math.max(3600, toNumber(data.interval_seconds, 3600)),
    autoDeleteInvalid: toBool(data.auto_delete_invalid),
    running: toBool(data.running),
    trigger: toText(data.trigger),
    currentFile: toText(data.current_file),
    recentChecked: Array.isArray(data.recent_checked)
      ? data.recent_checked.map((item) => toText(item)).filter(Boolean).slice(-10)
      : [],
    checked: toNumber(data.checked),
    valid: toNumber(data.valid),
    invalid: toNumber(data.invalid),
    deleted: toNumber(data.deleted),
    total: toNumber(data.total),
    round: toNumber(data.round),
    lastError: toText(data.last_error),
    lastRunStartedAt: toText(data.last_run_started_at),
    lastRunFinished: toText(data.last_run_finished),
    nextRunAt: toText(data.next_run_at),
  };
};

const INVALID_PAGE_SIZE = 20;

const formatInvalidMeta = (item: AuthFileItem): string => {
  const provider = toText(item.provider ?? item.type).toLowerCase() || 'unknown';
  const statusMessage = toText(item.status_message);
  const updatedAt = toText(item.updated_at ?? item.modtime);
  if (statusMessage && updatedAt) return `${provider} · ${statusMessage} · ${updatedAt}`;
  if (statusMessage) return `${provider} · ${statusMessage}`;
  if (updatedAt) return `${provider} · ${updatedAt}`;
  return provider;
};

export function AuthInspectionPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const [invalidFiles, setInvalidFiles] = useState<AuthFileItem[]>([]);
  const [invalidTotal, setInvalidTotal] = useState(0);
  const [invalidPage, setInvalidPage] = useState(1);
  const [invalidLoading, setInvalidLoading] = useState(false);
  const [error, setError] = useState('');
  const [inspection, setInspection] = useState<InspectionState>(defaultInspectionState);
  const [scheduleValue, setScheduleValue] = useState('3600');
  const [autoDeleteInvalid, setAutoDeleteInvalid] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [countdownSec, setCountdownSec] = useState(0);
  const [configDirty, setConfigDirty] = useState(false);
  const wasRunningRef = useRef(false);
  const statusLoadingRef = useRef(false);
  const latestInspectionRef = useRef<InspectionState>(defaultInspectionState);
  const testSessionRef = useRef<{
    baselineStartedAt: string;
    observedRun: boolean;
    deadlineAt: number;
  } | null>(null);

  const loadInvalidFiles = useCallback(
    async (page: number, silent = false) => {
      setInvalidLoading(true);
      try {
        const data = await authFilesApi.listInvalid({
          provider: 'codex',
          page,
          pageSize: INVALID_PAGE_SIZE,
        });
        const nextFiles = Array.isArray(data?.files) ? data.files : [];
        const nextTotal = toNumber(data?.total, nextFiles.length);
        const lastPage = Math.max(1, Math.ceil(nextTotal / INVALID_PAGE_SIZE));
        setInvalidFiles(nextFiles);
        setInvalidTotal(nextTotal);
        if (page > lastPage) {
          setInvalidPage(lastPage);
        }
        setError('');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : t('notification.refresh_failed');
        if (!silent) showNotification(msg, 'error');
        setError(msg);
      } finally {
        setInvalidLoading(false);
      }
    },
    [showNotification, t]
  );

  const loadInspectionStatus = useCallback(
    async (silent = false): Promise<InspectionState | null> => {
      if (statusLoadingRef.current) {
        return latestInspectionRef.current;
      }
      statusLoadingRef.current = true;
      try {
        const resp = await authFilesApi.getInspectionStatus();
        const normalized = normalizeInspectionState(resp?.inspection);
        setInspection(normalized);
        latestInspectionRef.current = normalized;
        if (!configDirty) {
          setScheduleValue(normalized.enabled ? String(normalized.intervalSeconds) : 'off');
          setAutoDeleteInvalid(normalized.autoDeleteInvalid);
        }
        if (!silent) setError('');
        return normalized;
      } catch (err: unknown) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : t('notification.refresh_failed');
          setError(msg);
          showNotification(msg, 'error');
        }
        return null;
      } finally {
        statusLoadingRef.current = false;
      }
    },
    [configDirty, showNotification, t]
  );

  useHeaderRefresh(
    useCallback(async () => {
      await Promise.all([loadInvalidFiles(invalidPage, true), loadInspectionStatus(true)]);
    }, [invalidPage, loadInspectionStatus, loadInvalidFiles])
  );

  useEffect(() => {
    void loadInspectionStatus();
  }, [loadInspectionStatus]);

  useEffect(() => {
    void loadInvalidFiles(invalidPage);
  }, [invalidPage, loadInvalidFiles]);

  useEffect(() => {
    latestInspectionRef.current = inspection;
    const nextRunTs = Date.parse(inspection.nextRunAt);
    if (!Number.isFinite(nextRunTs) || nextRunTs <= 0) {
      setCountdownSec(0);
      return;
    }
    const remaining = Math.max(0, Math.floor((nextRunTs - Date.now()) / 1000));
    setCountdownSec(remaining);
  }, [inspection.nextRunAt]);

  useInterval(
    () => {
      setCountdownSec((prev) => (prev > 0 ? prev - 1 : 0));
    },
    inspection.enabled ? 1000 : null
  );

  const statusPollMs = inspection.running || testing ? 2500 : 10000;
  useInterval(
    () => {
      if (disableControls) return;
      void loadInspectionStatus(true);
    },
    disableControls ? null : statusPollMs
  );

  useInterval(
    () => {
      if (disableControls || inspection.running) return;
      void loadInvalidFiles(invalidPage, true);
    },
    disableControls ? null : 30000
  );

  useEffect(() => {
    if (wasRunningRef.current && !inspection.running) {
      void loadInvalidFiles(invalidPage, true);
    }
    wasRunningRef.current = inspection.running;
  }, [inspection.running, invalidPage, loadInvalidFiles]);

  const progressPercent =
    inspection.total > 0
      ? Math.max(0, Math.min(100, Math.round((inspection.checked / inspection.total) * 100)))
      : 0;
  const totalInvalidPages = Math.max(1, Math.ceil(invalidTotal / INVALID_PAGE_SIZE));

  const formatDuration = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0秒';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0 && m > 0) return `${h}小时${m}分钟`;
    if (h > 0) return `${h}小时`;
    if (m > 0 && s > 0) return `${m}分${s}秒`;
    if (m > 0) return `${m}分钟`;
    return `${s}秒`;
  };

  const saveInspectionConfig = useCallback(async () => {
    if (disableControls) return;
    const enabled = scheduleValue !== 'off';
    const interval = enabled ? Math.max(3600, Number.parseInt(scheduleValue, 10) || 3600) : 3600;

    setSavingConfig(true);
    try {
      await authFilesApi.updateInspectionConfig({
        enabled,
        interval_seconds: interval,
        auto_delete_invalid: autoDeleteInvalid,
      });
      setConfigDirty(false);
      await loadInspectionStatus(true);
      showNotification(
        t('auth_inspection.config_saved', { defaultValue: '自动巡检配置已保存到后端' }),
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.update_failed')}: ${msg}`, 'error');
    } finally {
      setSavingConfig(false);
    }
  }, [autoDeleteInvalid, disableControls, loadInspectionStatus, scheduleValue, showNotification, t]);

  const runInspectionNow = useCallback(async () => {
    if (disableControls || inspection.running) return;
    try {
      const resp = await authFilesApi.runInspectionNow();
      const started = toBool(resp?.started);
      if (!started) {
        showNotification(
          t('auth_inspection.already_running', { defaultValue: '巡检任务已在运行中' }),
          'info'
        );
      } else {
        showNotification(
          t('auth_inspection.started', { defaultValue: '已触发后台巡检任务' }),
          'success'
        );
      }
      await loadInspectionStatus(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      showNotification(`${t('auth_files.verify_invalid_failed')}: ${msg}`, 'error');
    }
  }, [disableControls, inspection.running, loadInspectionStatus, showNotification, t]);

  const runInspectionTest = useCallback(async () => {
    if (disableControls || inspection.running || deleting || testing) return;
    try {
      const resp = await authFilesApi.runInspectionNow();
      const started = toBool(resp?.started);
      if (!started) {
        showNotification(
          t('auth_inspection.already_running', { defaultValue: '巡检任务已在运行中' }),
          'info'
        );
        await loadInspectionStatus(true);
        return;
      }

      testSessionRef.current = {
        baselineStartedAt: inspection.lastRunStartedAt,
        observedRun: false,
        deadlineAt: Date.now() + 30 * 60 * 1000,
      };
      setTesting(true);
      showNotification(
        t('auth_inspection.test_started', { defaultValue: '测试巡检已启动，正在实时刷新执行过程' }),
        'success'
      );
      await loadInspectionStatus(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      showNotification(`${t('auth_files.verify_invalid_failed')}: ${msg}`, 'error');
      setTesting(false);
      testSessionRef.current = null;
    }
  }, [deleting, disableControls, inspection.lastRunStartedAt, inspection.running, loadInspectionStatus, showNotification, t, testing]);

  useEffect(() => {
    if (!testing) return;
    const session = testSessionRef.current;
    if (!session) {
      setTesting(false);
      return;
    }

    if (inspection.running || inspection.lastRunStartedAt !== session.baselineStartedAt) {
      session.observedRun = true;
    }

    if (Date.now() >= session.deadlineAt) {
      setTesting(false);
      testSessionRef.current = null;
      showNotification(
        t('auth_inspection.test_timeout', { defaultValue: '测试巡检等待超时，请查看当前任务状态。' }),
        'warning'
      );
      return;
    }

    if (session.observedRun && !inspection.running) {
      setTesting(false);
      testSessionRef.current = null;
      const checked = toNumber(inspection.checked);
      const invalid = toNumber(inspection.invalid);
      setInvalidPage(1);
      void loadInvalidFiles(1, true);
      showNotification(
        t('auth_inspection.test_finished', {
          defaultValue: '测试巡检结束：已检查 {{checked}}，失效 {{invalid}}',
          checked,
          invalid,
        }),
        'success'
      );
    }
  }, [inspection, loadInvalidFiles, showNotification, t, testing]);

  const clearInvalid = useCallback(() => {
    showConfirmation({
      title: t('auth_files.delete_invalid_title', { defaultValue: '清理失效认证文件' }),
      message: t('auth_files.delete_invalid_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        setDeleting(true);
        try {
          const response = await authFilesApi.deleteInvalid();
          const deletedCount = toNumber(response?.deleted);
          const matchedCount = toNumber(response?.matched);
          setInvalidPage(1);
          await loadInvalidFiles(1, true);
          await loadInspectionStatus(true);
          if (matchedCount === 0) {
            showNotification(t('auth_files.delete_invalid_none'), 'info');
          } else {
            showNotification(
              t('auth_files.delete_invalid_success', { deleted: deletedCount, matched: matchedCount }),
              'success'
            );
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '';
          showNotification(`${t('notification.delete_failed')}: ${msg}`, 'error');
        } finally {
          setDeleting(false);
        }
      },
    });
  }, [loadInspectionStatus, loadInvalidFiles, showConfirmation, showNotification, t]);

  const changeInvalidPage = useCallback((nextPage: number) => {
    if (nextPage < 1 || nextPage > totalInvalidPages || nextPage === invalidPage) return;
    setInvalidPage(nextPage);
  }, [invalidPage, totalInvalidPages]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('auth_inspection.title', { defaultValue: '认证巡检中心' })}</h1>
        <p className={styles.description}>
          {t('auth_inspection.desc', {
            defaultValue: '后端持久化的自动巡检任务。页面关闭后任务仍会按小时继续运行。',
          })}
        </p>
      </div>

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
                      duration: formatDuration(countdownSec),
                    })
                  : t('auth_inspection.schedule_off', { defaultValue: '自动任务已关闭' })}
              </span>
            </div>
            <Select
              value={scheduleValue}
              options={scheduleOptions}
              onChange={(value) => {
                setScheduleValue(value);
                setConfigDirty(true);
              }}
              ariaLabel={t('auth_inspection.schedule_label', { defaultValue: '任务频率' })}
              fullWidth={false}
            />
            <ToggleSwitch
              checked={autoDeleteInvalid}
              onChange={(value) => {
                setAutoDeleteInvalid(value);
                setConfigDirty(true);
              }}
              label={t('auth_inspection.auto_delete', { defaultValue: '自动清理失效文件' })}
              disabled={disableControls}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={saveInspectionConfig}
              disabled={disableControls || !configDirty || savingConfig}
              loading={savingConfig}
            >
              {t('auth_inspection.save_config', { defaultValue: '保存策略' })}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={runInspectionNow}
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
              onClick={runInspectionTest}
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
              onClick={clearInvalid}
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
        {error && <div className={styles.errorBox}>{error}</div>}

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
            <div className={styles.summaryLabel}>{t('auth_inspection.deleted', { defaultValue: '自动清理' })}</div>
            <div className={styles.summaryValue}>{inspection.deleted}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t('auth_inspection.page_state', { defaultValue: '任务状态' })}</div>
            <div className={styles.summaryValue}>
              {inspection.running
                ? t('auth_inspection.executing', { defaultValue: '运行中' })
                : t('auth_inspection.idle', { defaultValue: '空闲' })}
            </div>
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
      </Card>

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
              onClick={() => changeInvalidPage(invalidPage - 1)}
              disabled={invalidPage <= 1 || invalidLoading}
            >
              {t('common.previous', { defaultValue: '上一页' })}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => changeInvalidPage(invalidPage + 1)}
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
    </div>
  );
}
