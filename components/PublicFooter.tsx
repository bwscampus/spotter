import Link from "next/link";
import { CONTACT_EMAIL, CONTACT_MAILTO, SITE_NAME } from "@/lib/ui/site";

/** The footer under the landing, privacy, terms and contact pages. */
export function PublicFooter() {
  return (
    <footer className="dash mt-auto border-t border-line bg-surface-2">
      <div className="mx-auto flex w-full max-w-[960px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 text-[12px]">
        <span className="text-muted">{SITE_NAME}</span>
        <nav aria-label="Site" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/privacy" className="text-accent hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="text-accent hover:underline">
            Terms
          </Link>
          <Link href="/contact" className="text-accent hover:underline">
            Contact
          </Link>
        </nav>
        <a href={CONTACT_MAILTO} className="text-muted hover:underline sm:ml-auto">
          {CONTACT_EMAIL}
        </a>
      </div>
    </footer>
  );
}
