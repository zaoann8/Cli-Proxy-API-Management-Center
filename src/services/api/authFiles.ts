/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient } from './client';
import type { AuthFilesResponse } from '@/types/authFile';
import type { OAuthModelAliasEntry } from '@/types';

type StatusError = { status?: number };
type AuthFileStatusResponse = { status: string; disabled: boolean };
type DeleteFailedResponse = { status?: string; deleted?: number; matched?: number; scope?: string };
type DeleteInvalidResponse = { status?: string; deleted?: number; matched?: number; scope?: string };
type VerifyInvalidItem = {
  id?: string;
  name?: string;
  provider?: string;
  invalid?: boolean;
  reason?: string;
};

type VerifyInvalidResponse = {
  status?: string;
  scope?: string;
  provider?: string;
  concurrency?: number;
  batch_size?: number;
  cursor?: number;
  next_cursor?: number;
  total?: number;
  done?: boolean;
  checked?: number;
  valid?: number;
  invalid?: number;
  skipped?: number;
  results?: VerifyInvalidItem[];
};

type AuthInspectionConfigResponse = {
  enabled?: boolean;
  interval_seconds?: number;
  auto_delete_invalid?: boolean;
  min_interval_seconds?: number;
  max_interval_seconds?: number;
};

type AuthInspectionStatusItem = {
  enabled?: boolean;
  interval_seconds?: number;
  auto_delete_invalid?: boolean;
  running?: boolean;
  trigger?: string;
  current_file?: string;
  recent_checked?: string[];
  checked?: number;
  valid?: number;
  invalid?: number;
  deleted?: number;
  total?: number;
  round?: number;
  last_error?: string;
  last_run_started_at?: string;
  last_run_finished?: string;
  next_run_at?: string;
};

type AuthInspectionStatusResponse = {
  status?: string;
  inspection?: AuthInspectionStatusItem;
};

type UploadAuthBatchFailure = {
  name?: string;
  error?: string;
};

type UploadAuthBatchResponse = {
  status?: string;
  uploaded?: number;
  total?: number;
  failed?: UploadAuthBatchFailure[];
};

const getStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  if ('status' in err) return (err as StatusError).status;
  return undefined;
};

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-excluded-models'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, string[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
    const key = String(provider ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;

    const rawList = Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(/[\n,]+/)
        : [];

    const seen = new Set<string>();
    const normalized: string[] = [];
    rawList.forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const modelKey = trimmed.toLowerCase();
      if (seen.has(modelKey)) return;
      seen.add(modelKey);
      normalized.push(trimmed);
    });

    result[key] = normalized;
  });

  return result;
};

const normalizeOauthModelAlias = (payload: unknown): Record<string, OAuthModelAliasEntry[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source =
    record['oauth-model-alias'] ??
    record.items ??
    payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, OAuthModelAliasEntry[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
    const key = String(channel ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;
    if (!Array.isArray(mappings)) return;

	    const seen = new Set<string>();
	    const normalized = mappings
	      .map((item) => {
	        if (!item || typeof item !== 'object') return null;
	        const entry = item as Record<string, unknown>;
	        const name = String(entry.name ?? entry.id ?? entry.model ?? '').trim();
	        const alias = String(entry.alias ?? '').trim();
	        if (!name || !alias) return null;
	        const fork = entry.fork === true;
	        return fork ? { name, alias, fork } : { name, alias };
	      })
      .filter(Boolean)
      .filter((entry) => {
        const aliasEntry = entry as OAuthModelAliasEntry;
        const dedupeKey = `${aliasEntry.name.toLowerCase()}::${aliasEntry.alias.toLowerCase()}::${aliasEntry.fork ? '1' : '0'}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      }) as OAuthModelAliasEntry[];

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

const OAUTH_MODEL_ALIAS_ENDPOINT = '/oauth-model-alias';

export const authFilesApi = {
  list: () =>
    apiClient.get<AuthFilesResponse>('/auth-files', {
      timeout: 300000
    }),

  listInvalid: (options?: {
    provider?: string;
    page?: number;
    pageSize?: number;
    search?: string;
  }) =>
    apiClient.get<AuthFilesResponse>('/auth-files', {
      params: {
        invalid_only: true,
        provider: options?.provider ?? 'codex',
        page: options?.page ?? 1,
        page_size: options?.pageSize ?? 20,
        ...(options?.search ? { search: options.search } : {})
      },
      timeout: 300000
    }),

  setStatus: (name: string, disabled: boolean) =>
    apiClient.patch<AuthFileStatusResponse>('/auth-files/status', { name, disabled }),

  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return apiClient.postForm('/auth-files', formData, { timeout: 300000 });
  },

  uploadBatch: (files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file, file.name);
    });
    return apiClient.postForm<UploadAuthBatchResponse>('/auth-files', formData, { timeout: 300000 });
  },

  deleteFile: (name: string) => apiClient.delete(`/auth-files?name=${encodeURIComponent(name)}`),

  deleteAll: () => apiClient.delete('/auth-files', { params: { all: true } }),

  deleteFailed: () =>
    apiClient.delete<DeleteFailedResponse>('/auth-files', {
      params: { failed: true },
      timeout: 300000
    }),

  deleteInvalid: () =>
    apiClient.delete<DeleteInvalidResponse>('/auth-files', {
      params: { invalid: true },
      timeout: 300000
    }),

  verifyInvalid: (
    provider: string = 'codex',
    concurrency: number = 20,
    cursor: number = 0,
    batchSize: number = 100
  ) =>
    apiClient.post<VerifyInvalidResponse>('/auth-files/verify-invalid', null, {
      params: { provider, concurrency, cursor, batch_size: batchSize },
      timeout: 300000
    }),

  getInspectionConfig: () =>
    apiClient.get<AuthInspectionConfigResponse>('/auth-files/inspection-config'),

  updateInspectionConfig: (payload: {
    enabled?: boolean;
    interval_seconds?: number;
    auto_delete_invalid?: boolean;
  }) =>
    apiClient.put<AuthInspectionConfigResponse>('/auth-files/inspection-config', payload),

  getInspectionStatus: () =>
    apiClient.get<AuthInspectionStatusResponse>('/auth-files/inspection-status'),

  runInspectionNow: () =>
    apiClient.post<{ status?: string; started?: boolean; inspection?: AuthInspectionStatusItem }>(
      '/auth-files/inspection-run'
    ),

  downloadText: async (name: string): Promise<string> => {
    const response = await apiClient.getRaw(`/auth-files/download?name=${encodeURIComponent(name)}`, {
      responseType: 'blob'
    });
    const blob = response.data as Blob;
    return blob.text();
  },

  // OAuth 排除模型
  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await apiClient.get('/oauth-excluded-models');
    return normalizeOauthExcludedModels(data);
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    apiClient.patch('/oauth-excluded-models', { provider, models }),

  deleteOauthExcludedEntry: (provider: string) =>
    apiClient.delete(`/oauth-excluded-models?provider=${encodeURIComponent(provider)}`),

  replaceOauthExcludedModels: (map: Record<string, string[]>) =>
    apiClient.put('/oauth-excluded-models', normalizeOauthExcludedModels(map)),

  // OAuth 模型别名
  async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
    const data = await apiClient.get(OAUTH_MODEL_ALIAS_ENDPOINT);
    return normalizeOauthModelAlias(data);
  },

  saveOauthModelAlias: async (channel: string, aliases: OAuthModelAliasEntry[]) => {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();
    const normalizedAliases = normalizeOauthModelAlias({ [normalizedChannel]: aliases })[normalizedChannel] ?? [];
    await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, { channel: normalizedChannel, aliases: normalizedAliases });
  },

  deleteOauthModelAlias: async (channel: string) => {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();

    try {
      await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, { channel: normalizedChannel, aliases: [] });
    } catch (err: unknown) {
      const status = getStatusCode(err);
      if (status !== 405) throw err;
      await apiClient.delete(`${OAUTH_MODEL_ALIAS_ENDPOINT}?channel=${encodeURIComponent(normalizedChannel)}`);
    }
  },

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(name: string): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get<Record<string, unknown>>(
      `/auth-files/models?name=${encodeURIComponent(name)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  // 获取指定 channel 的模型定义
  async getModelDefinitions(channel: string): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const normalizedChannel = String(channel ?? '').trim().toLowerCase();
    if (!normalizedChannel) return [];
    const data = await apiClient.get<Record<string, unknown>>(
      `/model-definitions/${encodeURIComponent(normalizedChannel)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  }
};
