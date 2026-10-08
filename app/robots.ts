import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/ui/site";

/**
 * Crawlers may read the four public pages and nothing else. "/$" is the
 * landing page alone; the longer, more specific rules win over "Disallow: /".
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/privacy", "/terms", "/contact", "/opengraph-image.png"],
      disallow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
