import type { CaseFileResponse } from "@iz/schema";
import { useSessionStore } from "@iz/ui";

/**
 * GET /api/case (M1 task 8): the server's case-file projection — open gates
 * and the definition of reports whose gates are visible to this team. Slot
 * answer data never leaves the server; hint text arrives only as the RESULT of
 * an accepted requestHint action (cost deducted server-side). The kit client
 * (packages/ui) predates this endpoint, so the panel fetches it here with the
 * same conventions as packages/ui/src/api/client.ts (bearer token, JSON).
 */
export async function fetchCaseFile(): Promise<CaseFileResponse> {
  const token = useSessionStore.getState().session?.token;
  const headers: Record<string, string> = { accept: "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const response = await fetch("/api/case", { headers });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown; message?: unknown };
      if (typeof body.error === "string") message = body.error;
      else if (typeof body.message === "string") message = body.message;
    } catch {
      /* non-JSON body — keep the status message */
    }
    throw new Error(message);
  }
  return (await response.json()) as CaseFileResponse;
}
