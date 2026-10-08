"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

/** Any page that throws, under the root layout, so the header stays. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
