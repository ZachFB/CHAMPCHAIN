import { useCallback, useEffect, useRef, useState } from "react";
import {
  runTxlineActivation,
  loadPersistedGrant,
  clearPersistedGrant,
} from "../lib/txlineAuth.js";
import { TXLINE_NETWORK, txlineConfig } from "../lib/txlineConfig.js";

/**
 * Orchestrates the real TxLINE guest-activation flow (subscribe on-chain ->
 * guest JWT -> signed activation) against a connected wallet-adapter wallet.
 *
 * status:
 *   'disconnected'      no wallet connected yet
 *   'idle'               wallet connected, not yet activated this session
 *   'restored'           a non-expired grant was found in localStorage
 *   'subscribing'        sending the on-chain subscribe() transaction
 *   'authenticating'     fetching the guest JWT
 *   'awaiting-signature' waiting on wallet.signMessage()
 *   'activating'         calling /api/token/activate
 *   'ready'              jwt + apiToken are valid, streams/proofs can use them
 *   'error'              see `error`
 */
export function useTxlineAuth(wallet) {
  const [status, setStatus] = useState("disconnected");
  const [grant, setGrant] = useState(null); // { jwt, apiToken, txSig, expiresAt }
  const [error, setError] = useState(null);
  const activatingRef = useRef(false);

  const pubkeyBase58 = wallet?.publicKey?.toBase58() ?? null;

  // Auto-restore a still-valid grant as soon as the wallet connects, so
  // people don't have to re-subscribe every page load (subscriptions last
  // TXLINE_SUBSCRIPTION_WEEKS, i.e. 4 weeks).
  useEffect(() => {
    if (!pubkeyBase58) {
      setStatus("disconnected");
      setGrant(null);
      return;
    }
    const persisted = loadPersistedGrant(TXLINE_NETWORK, pubkeyBase58);
    if (persisted) {
      setGrant(persisted);
      setStatus("ready");
    } else {
      setStatus("idle");
    }
  }, [pubkeyBase58]);

  const activate = useCallback(async () => {
    if (activatingRef.current) return;
    if (!wallet?.publicKey) {
      setError("Connect your wallet first.");
      setStatus("error");
      return;
    }
    activatingRef.current = true;
    setError(null);
    try {
      const result = await runTxlineActivation({
        wallet,
        network: TXLINE_NETWORK,
        onStatus: setStatus,
      });
      setGrant(result);
      setStatus("ready");
    } catch (err) {
      setError(err?.message ?? String(err));
      setStatus("error");
      throw err; // let the caller (the "Validate live data" button) know it
                 // actually failed — swallowing it here was exactly why a
                 // failed activation was still showing a success toast.
    } finally {
      activatingRef.current = false;
    }
  }, [wallet]);

  const reset = useCallback(() => {
    if (pubkeyBase58) clearPersistedGrant(TXLINE_NETWORK, pubkeyBase58);
    setGrant(null);
    setStatus(pubkeyBase58 ? "idle" : "disconnected");
  }, [pubkeyBase58]);

  return {
    status,
    error,
    jwt: grant?.jwt ?? null,
    apiToken: grant?.apiToken ?? null,
    txSig: grant?.txSig ?? null,
    expiresAt: grant?.expiresAt ?? null,
    isReady: status === "ready" && !!grant?.jwt && !!grant?.apiToken,
    apiOrigin: txlineConfig(TXLINE_NETWORK).apiOrigin,
    activate,
    reset,
  };
}
