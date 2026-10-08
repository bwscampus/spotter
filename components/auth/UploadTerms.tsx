"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/apiClient";

/**
 * Whether the account has ticked "I have the right to use this roster or stats
 * sheet" (audit M5), and the way to tick it. Defaults to accepted, so a page
 * rendered without the layout (a test) imports as it always did.
 */
interface UploadTerms {
  accepted: boolean;
  accept: () => Promise<void>;
}

const UploadTermsContext = createContext<UploadTerms>({ accepted: true, accept: async () => undefined });

/** Carries what the root layout read about the upload consent down to the import panels. */
export function UploadTermsProvider({ accepted: acceptedOnServer = true, children }: { accepted?: boolean; children: ReactNode }) {
  // Ticked on this page, on top of what the server read.
  const [ticked, setTicked] = useState(false);
  const accepted = acceptedOnServer || ticked;

  // The tick counts at once for this page: the person agreed. The time is
  // stored through POST /api/upload-terms; if that fails, the next page load asks again.
  const accept = useCallback(async () => {
    setTicked(true);
    const result = await api("POST", "/api/upload-terms");
    if (!result.ok) console.warn(`[Spotter] Could not record the upload terms (${result.code ?? result.status}).`);
  }, []);

  const terms = useMemo(() => ({ accepted, accept }), [accepted, accept]);

  return <UploadTermsContext.Provider value={terms}>{children}</UploadTermsContext.Provider>;
}

/** The upload consent: whether it is given, and how to give it. */
export function useUploadTerms(): UploadTerms {
  return useContext(UploadTermsContext);
}
