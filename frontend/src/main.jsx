import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
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

const endpoint = clusterApiUrl("devnet");
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

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