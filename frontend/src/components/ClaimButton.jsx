import { useState } from "react";
import { toast } from "./Toast.jsx";
import Spinner from "./Spinner.jsx";

export default function ClaimButton({ matchId, onClaim, label = "CLAIM WINNINGS" }) {
  const [status, setStatus] = useState("");
  const [claiming, setClaiming] = useState(false);

  async function handleClick() {
    setClaiming(true);
    setStatus("");
    try {
      const result = await onClaim(matchId);
      setStatus(result || "Claimed.");
      toast("Funds released from the vault.", { type: "success" });
    } catch (e) {
      const msg = e?.message?.slice(0, 90) || "Claim failed.";
      setStatus(msg);
      toast(`Claim failed: ${msg}`, { type: "error" });
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={claiming}
        className="w-full flex items-center justify-center gap-2 border border-card-yes text-card-yes font-display tracking-wide py-2 rounded-sm hover:bg-card-yes hover:text-turf active:scale-95 transition text-sm disabled:opacity-50 disabled:cursor-wait"
      >
        {claiming && <Spinner className="h-4 w-4" />}
        {claiming ? "CLAIMING…" : label}
      </button>
      {status && (
        <p className="font-mono text-xs text-haze mt-2 text-center">{status}</p>
      )}
    </div>
  );
}