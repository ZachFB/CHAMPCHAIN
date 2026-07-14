import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { CoinbaseWalletAdapter, TrustWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import App from "./App.jsx";
import { ToastHost } from "./components/Toast.jsx";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";

// ScrollTrigger measures each trigger's position against the page's height
// at the moment it's created. Web fonts (Anton, Inter, JetBrains Mono —
// all @import'd in index.css) and images can finish loading and reflow the
// page AFTER that first measurement, silently shifting where "the bottom
// of the page" actually is versus what ScrollTrigger cached. Refreshing
// once everything has truly settled keeps its measurements honest instead
// of leaving stale ones that can make the page feel like it has extra,
// unreachable scroll space.
window.addEventListener("load", () => {
  requestAnimationFrame(() => ScrollTrigger.refresh());
});

// Prefer a dedicated RPC (Helius) when configured — Solana's public
// clusterApiUrl("devnet") is shared, rate-limited, and prone to slow
// confirmations under load (the "Transaction was not confirmed in 30.00
// seconds" warning), which is risky mid-demo. Falls back to the public
// endpoint if VITE_HELIUS_RPC_URL isn't set, so local dev still works
// without any extra setup.
const endpoint = import.meta.env.VITE_HELIUS_RPC_URL || clusterApiUrl("devnet");

// No explicit wallet adapters needed here. Two separate mechanisms cover
// everything without us hardcoding a single wallet's SDK:
//
// 1. Desktop, any installed extension (Phantom, Solflare, Backpack,
//    Coinbase Wallet, Trust Wallet's extension, etc.): they all register
//    themselves automatically via the Wallet Standard, which
//    WalletProvider picks up on its own. This used to be done with
//    explicit `new PhantomWalletAdapter()` etc.; keeping those alongside
//    Wallet Standard just causes duplicate entries and console warnings
//    ("Phantom was registered as a Standard Wallet...").
//
// 2. Mobile browser (Android), no extension: @solana/wallet-adapter-react
//    (already a dependency, >=0.15.21) bundles Mobile Wallet Adapter (MWA)
//    support internally and enables it automatically when it detects a
//    compatible mobile environment — no separate package, no manual
//    SolanaMobileWalletAdapter instance required. It launches whichever
//    MWA-compliant wallet app (Phantom, Solflare, etc.) is installed on
//    the phone via an Android intent, and MWA explicitly supports Devnet
//    as a first-class cluster, so this is safe to use as-is here.
//
// Known gap, worth being upfront about: this covers Android, not iOS —
// there's no equivalent OS-level channel there yet. A true cross-device
// "scan this QR code from your desktop" flow (WalletConnect) was
// considered and deliberately left out: WalletConnect's own Solana
// adapter README states most mobile wallets don't support Testnet/Devnet
// over that protocol, so it would likely look connected and then fail to
// sign anything — not worth the risk on a Devnet-only app this close to
// the deadline. Worth revisiting once/if this moves to mainnet.
// Phantom, Solflare, Backpack: no explicit adapter needed, they register
// via Wallet Standard automatically when their extension is present.
// Coinbase Wallet and Trust Wallet are listed explicitly below because,
// unlike Phantom/Solflare, they don't reliably self-register yet — adding
// them here is what makes them show up as named options in the connect
// modal (with an install link if the person doesn't have them), instead
// of being invisible unless already installed.
const wallets = [new CoinbaseWalletAdapter(), new TrustWalletAdapter()];

// One shared client for every on-chain read/write in the app. Devnet RPC is
// flaky under hackathon load, so queries/mutations get a bounded retry with
// backoff instead of failing on the first dropped request, and market data
// is deduped across components instead of every card polling on its own.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 6000),
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <App />
            <ToastHost />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  </React.StrictMode>
);