"use client";

import { ErrorScreen } from "@/components/ErrorScreen";
import "./globals.css";

/**
 * The root layout itself threw. This replaces the whole document, so it brings
 * its own html, body, title and styles. The fonts fall back to the system's.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="bg-white text-black">
        <title>Something went wrong | StatCast</title>
        <ErrorScreen error={error} retry={retry} />
      </body>
    </html>
  );
}
