import { ExternalStore } from './external-store';

/** Paths, codes and timestamps only. Never request bodies, keys or amounts. */
export interface Diagnostics {
  lastApiSuccessAt: number | null;
  lastApiSuccessPath: string | null;
  lastApiError: { path: string; code: string; at: number } | null;
  lastBalanceRefreshAt: number | null;
}

export const diagnosticsStore = new ExternalStore<Diagnostics>({
  lastApiSuccessAt: null,
  lastApiSuccessPath: null,
  lastApiError: null,
  lastBalanceRefreshAt: null,
});

export const apiTelemetry = {
  onSuccess(path: string) {
    diagnosticsStore.set((state) => ({
      ...state,
      lastApiSuccessAt: Date.now(),
      lastApiSuccessPath: path,
      lastBalanceRefreshAt: path === '/balance' ? Date.now() : state.lastBalanceRefreshAt,
    }));
  },
  onError(path: string, code: string) {
    diagnosticsStore.set((state) => ({ ...state, lastApiError: { path, code, at: Date.now() } }));
  },
};
