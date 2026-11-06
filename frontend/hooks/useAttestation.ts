"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchAttestation, getAttestationStatus, type AttestationState } from "../lib/api/attestation";

export function useAttestation() {
  const [attestation, setAttestation] = useState<AttestationState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadAttestation = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const state = await getAttestationStatus();
      setAttestation(state);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch hardware attestation.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAttestation();
  }, [loadAttestation]);

  return {
    attestation,
    isLoading,
    error,
    refresh: loadAttestation,
  };
}
