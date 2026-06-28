/**
 * `useProver` — thin React wrapper around `generateAndVerifyProof`.
 *
 * Tracks the in-flight state and surfaces the latest error so the UI can
 * render a spinner and toast on failure.
 */

import { useCallback, useState } from "react";
import { generateAndVerifyProof } from "@/lib/prover";
import type { ProverRequest, VerifiedProof } from "@/lib/types";

export interface UseProverResult {
  generateProof: (request: ProverRequest) => Promise<VerifiedProof>;
  generating: boolean;
  error: string | null;
  clearError: () => void;
}

export function useProver(): UseProverResult {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateProof = useCallback(async (request: ProverRequest) => {
    setGenerating(true);
    setError(null);
    try {
      const proof = await generateAndVerifyProof(request);
      return proof;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Proof generation failed";
      setError(msg);
      throw err;
    } finally {
      setGenerating(false);
    }
  }, []);

  return { generateProof, generating, error, clearError: () => setError(null) };
}
