import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

// App shell lands with M1 task 2; this entry keeps the app buildable meanwhile.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <main style={{ fontFamily: "monospace", padding: "2rem" }}>
        <h1>INTRANET ZERO</h1>
        <p>A dead company's servers just woke up. Find out why.</p>
        <p>
          <em>The desktop shell is under construction.</em>
        </p>
      </main>
    </QueryClientProvider>
  </StrictMode>
);
