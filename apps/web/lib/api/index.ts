import { chainReader } from '../chain';
import { appConfig } from '../config';
import { apiTelemetry } from '../state/diagnostics';
import { CloakroomApi } from './client';

/** Longer than the default, since the first request can wait for the Anon-RPC client to start. */
const API_TIMEOUT_MS = 30_000;

export const api = new CloakroomApi({
  baseUrl: appConfig.apiUrl,
  telemetry: apiTelemetry,
  fetchFn: chainReader.apiFetch,
  timeoutMs: API_TIMEOUT_MS,
});
