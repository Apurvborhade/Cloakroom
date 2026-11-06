import { appConfig } from '../config';
import { apiTelemetry } from '../state/diagnostics';
import { CloakroomApi } from './client';

export const api = new CloakroomApi({ baseUrl: appConfig.apiUrl, telemetry: apiTelemetry });
