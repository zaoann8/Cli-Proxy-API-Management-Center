import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SelectOption } from '@/components/ui/Select';
import { AuthInspectionInvalidList } from '@/features/authFiles/components/AuthInspectionInvalidList';
import { AuthInspectionOverview } from '@/features/authFiles/components/AuthInspectionOverview';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { authFilesApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import styles from './AuthInspectionPage.module.scss';

type InspectionAction = 'none' | 'delete' | 'disable';

type InspectionState = {
  enabled: boolean;
  intervalSeconds: number;
  autoDeleteInvalid: boolean;
  invalidAction: InspectionAction;
  autoReenable: boolean;
  running: boolean;
  trigger: string;
  currentFile: string;
  recentChecked: string[];
  checked: number;
  valid: number;
  invalid: number;
  skipped: number;
  inconclusive: number;
  disabled: number;
  reenabled: number;
  deleted: number;
  total: number;
  round: number;
  reasonCounts: Record<string, number>;
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

const normalizeReasonCounts = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>((acc, [key, raw]) => {
    const name = toText(key);
    const count = toNumber(raw, 0);
    if (!name || count <= 0) return acc;
    acc[name] = count;
    return acc;
  }, {});
};

const normalizeInvalidAction = (value: unknown, autoDeleteInvalid: boolean): InspectionAction => {
  const text = toText(value).toLowerCase();
  if (text === 'delete' || text === 'disable' || text === 'none') {
    return text;
  }
  return autoDeleteInvalid ? 'delete' : 'none';
};

const defaultInspectionState: InspectionState = {
  enabled: false,
  intervalSeconds: 3600,
  autoDeleteInvalid: false,
  invalidAction: 'none',
  autoReenable: false,
  running: false,
  trigger: '',
  currentFile: '',
  recentChecked: [],
  checked: 0,
  valid: 0,
  invalid: 0,
  skipped: 0,
  inconclusive: 0,
  disabled: 0,
  reenabled: 0,
  deleted: 0,
  total: 0,
  round: 0,
  reasonCounts: {},
  lastError: '',
  lastRunStartedAt: '',
  lastRunFinished: '',
  nextRunAt: '',
};

const normalizeInspectionState = (raw: unknown): InspectionState => {
  const data = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const autoDeleteInvalid = toBool(data.auto_delete_invalid);
  return {
    enabled: toBool(data.enabled),
    intervalSeconds: Math.max(3600, toNumber(data.interval_seconds, 3600)),
    autoDeleteInvalid,
    invalidAction: normalizeInvalidAction(data.invalid_action, autoDeleteInvalid),
    autoReenable: toBool(data.auto_reenable),
    running: toBool(data.running),
    trigger: toText(data.trigger),
    currentFile: toText(data.current_file),
    recentChecked: Array.isArray(data.recent_checked)
      ? data.recent_checked.map((item) => toText(item)).filter(Boolean).slice(-10)
      : [],
    checked: toNumber(data.checked),
    valid: toNumber(data.valid),
    invalid: toNumber(data.invalid),
    skipped: toNumber(data.skipped),
    inconclusive: toNumber(data.inconclusive),
    disabled: toNumber(data.disabled),
    reenabled: toNumber(data.reenabled),
    deleted: toNumber(data.deleted),
    total: toNumber(data.total),
    round: toNumber(data.round),
    reasonCounts: normalizeReasonCounts(data.reason_counts),
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
  const [invalidAction, setInvalidAction] = useState<InspectionAction>('none');
  const [autoReenable, setAutoReenable] = useState(false);
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
          setInvalidAction(normalized.invalidAction);
          setAutoReenable(normalized.autoReenable);
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
      await authFilesApi.updateInspectionConfig(({
        enabled,
        interval_seconds: interval,
        auto_delete_invalid: invalidAction === 'delete',
        invalid_action: invalidAction,
        auto_reenable: autoReenable,
      } as Parameters<typeof authFilesApi.updateInspectionConfig>[0]));
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
  }, [autoReenable, disableControls, invalidAction, loadInspectionStatus, scheduleValue, showNotification, t]);

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

      {error && <div className={styles.errorBox}>{error}</div>}

      <AuthInspectionOverview
        countdownLabel={formatDuration(countdownSec)}
        disableControls={disableControls}
        invalidAction={invalidAction}
        invalidTotal={invalidTotal}
        scheduleOptions={scheduleOptions}
        scheduleValue={scheduleValue}
        configDirty={configDirty}
        savingConfig={savingConfig}
        deleting={deleting}
        testing={testing}
        progressPercent={progressPercent}
        autoReenable={autoReenable}
        inspection={inspection}
        onScheduleChange={(value) => {
          setScheduleValue(value);
          setConfigDirty(true);
        }}
        onInvalidActionChange={(value) => {
          setInvalidAction(value);
          setConfigDirty(true);
        }}
        onAutoReenableChange={(value) => {
          setAutoReenable(value);
          setConfigDirty(true);
        }}
        onSaveConfig={saveInspectionConfig}
        onRunNow={runInspectionNow}
        onRunTest={runInspectionTest}
        onClearInvalid={clearInvalid}
      />

      <AuthInspectionInvalidList
        invalidFiles={invalidFiles}
        invalidLoading={invalidLoading}
        invalidPage={invalidPage}
        invalidTotal={invalidTotal}
        totalInvalidPages={totalInvalidPages}
        onPrevPage={() => changeInvalidPage(invalidPage - 1)}
        onNextPage={() => changeInvalidPage(invalidPage + 1)}
        formatInvalidMeta={formatInvalidMeta}
      />
    </div>
  );
}
