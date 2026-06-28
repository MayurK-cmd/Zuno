/**
 * ZK proof generation + server-side verification.
 *
 * The proof is generated inside a Web Worker (`workers/prover.worker.ts`)
 * because Noir's witness generation can take 2-5 seconds and would block the
 * main thread otherwise. Once generated, we POST it to a verifier server
 * which checks the proof against the on-chain VK and signs it; the contract
 * requires this server signature to accept the move.
 *
 * Verifier endpoint:
 *     ${VITE_VERIFIER_SERVER_URL}/api/verify-${circuitName}
 *
 * Falls back to an offline "verify" that simply trusts the proof locally so
 * the demo flow works even without a running verifier server.
 */

import type { ProverRequest, ProverResponse, VerifiedProof } from "./types";

function verifierUrl(): string {
  const env = (import.meta as any).env?.VITE_VERIFIER_SERVER_URL;
  return env || "http://localhost:4000";
}

/**
 * Spawn the prover worker, send the request, and resolve with a verified
 * proof (or reject on any failure). Always terminates the worker before
 * resolving/rejecting.
 */
export function generateAndVerifyProof(request: ProverRequest): Promise<VerifiedProof> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(new Error("Web Workers are not supported in this browser"));
      return;
    }

    const worker = new Worker(new URL("../workers/prover.worker.ts", import.meta.url), {
      type: "module",
    });

    let settled = false;

    const cleanup = () => {
      worker.terminate();
    };

    worker.onmessage = async (event: MessageEvent<ProverResponse>) => {
      const data = event.data;
      if (data.status === "error") {
        settled = true;
        cleanup();
        reject(new Error(data.error));
        return;
      }

      try {
        const verified = await sendToVerifier(request, data.proofHex, data.publicInputs);
        settled = true;
        cleanup();
        resolve(verified);
      } catch (err) {
        settled = true;
        cleanup();
        reject(err);
      }
    };

    worker.onerror = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(err.message || "Prover worker crashed"));
    };

    worker.postMessage(request);
  });
}

/**
 * POST the proof + public inputs to the verifier server. If the server is
 * unreachable we fall back to a local trusted mode (signature = zeros) so
 * the demo flow still works. The contract will reject these in production.
 */
async function sendToVerifier(
  request: ProverRequest,
  proofHex: string,
  publicInputs: string[],
): Promise<VerifiedProof> {
  const url = `${verifierUrl()}/api/verify-${request.circuitName}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof: proofHex, publicInputs }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw new Error(`Verifier server returned ${res.status}`);
    }

    const json = (await res.json()) as { signature?: string; valid?: boolean };
    if (json.valid === false) {
      throw new Error("Verifier rejected the proof");
    }
    return {
      proofHex,
      publicInputs,
      signatureHex: json.signature ?? "",
    };
  } catch (err) {
    // Dev fallback: allow the UI to continue. Log so the user knows.
    if (import.meta.env.DEV) {
      console.warn(
        "[prover] verifier server unreachable — using unverified mode:",
        err instanceof Error ? err.message : String(err),
      );
      return {
        proofHex,
        publicInputs,
        signatureHex: "00".repeat(64),
      };
    }
    throw err;
  }
}
