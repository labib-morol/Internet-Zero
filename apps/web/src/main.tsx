import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { useSessionStore } from "@iz/ui";
import { LandingPage } from "./landing/LandingPage.js";
import { Shell } from "./shell/Shell.js";
import { installSessionLifecycle } from "./session-lifecycle.js";
import "./app.css";
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

// Case presentation content never outlives its session.
installSessionLifecycle();

function App(): React.JSX.Element {
  const screen = useSessionStore((s) => s.screen);
  const status = useSessionStore((s) => s.status);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void useSessionStore.getState().bootstrap().finally(() => {
      if (!cancelled) setBooted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!booted) {
    return (
      <main className="iz-root" style={{ minHeight: "100vh", padding: "2rem" }}>
        <p style={{ color: "var(--iz-dim)" }}>Opening the desktop…</p>
      </main>
    );
  }
  if (screen === "shell" && status === "ready") {
    return <Shell />;
  }
  return <LandingPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
