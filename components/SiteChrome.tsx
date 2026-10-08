"use client";

import { usePathname } from "next/navigation";
import { PublicHeader, SiteHeader } from "@/components/SiteHeader";
import { placeFor } from "@/lib/ui/nav";

/**
 * The header above every page, from the root layout, so no page draws or
 * feeds its own. The live screen keeps its own bar. A signed-out visitor on
 * the landing, privacy, terms or contact page gets the public bar instead.
 */
export function SiteChrome({ email }: { email: string | null }) {
  const place = placeFor(usePathname());
  if (place.public && email === null) return <PublicHeader />;
  const signedOut = place.signedOut || email === null;
  if (!place.header) return null;
  return <SiteHeader current={signedOut ? null : place.current} email={signedOut ? null : email} />;
}
