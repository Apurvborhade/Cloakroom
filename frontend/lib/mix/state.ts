import { MixConfig, MixExecutionRecord, MixActivityItem } from "./types";

const MIX_CONFIG_KEY = "cloakroom_mix_config_v1";
const MIX_EXECUTION_KEY = "cloakroom_mix_execution_v1";
const MIX_ACTIVITY_KEY = "cloakroom_mix_activity_v1";

export function saveMixConfig(config: MixConfig): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(MIX_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage quota or private browsing fallback
  }
}

export function loadMixConfig(): MixConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MIX_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearMixConfig(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(MIX_CONFIG_KEY);
  } catch {
    // ignore
  }
}

export function saveMixExecution(record: MixExecutionRecord): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(MIX_EXECUTION_KEY, JSON.stringify(record));

    // Also append to activity history if completed
    if (record.status === "completed") {
      addMixActivity({
        id: record.id,
        type: "MIX",
        status: "completed",
        asset: record.config.inputAsset,
        amount: record.config.inputAmount,
        destination: record.config.destinationAddress,
        txHash: record.txHash,
        batchId: record.batchId,
        timestamp: record.completedAt || new Date().toISOString(),
        isSimulation: record.isSimulation,
      });
    }
  } catch {
    // ignore
  }
}

export function loadMixExecution(): MixExecutionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MIX_EXECUTION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadMixActivity(): MixActivityItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MIX_ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addMixActivity(item: MixActivityItem): void {
  if (typeof window === "undefined") return;
  try {
    const current = loadMixActivity();
    // Prepend new activity
    const updated = [item, ...current.filter((x) => x.id !== item.id)].slice(0, 20);
    localStorage.setItem(MIX_ACTIVITY_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}
