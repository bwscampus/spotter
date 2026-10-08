import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicPage";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/ui/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach a person about Spotter.",
};

export default function Contact() {
  return (
    <PublicPage title="Contact">
      <p>
        Email{" "}
        <a href={CONTACT_MAILTO} className="font-semibold">
          {CONTACT_EMAIL}
        </a>
        . A person reads every message.
      </p>

      <h2>Write to us about</h2>
      <ul>
        <li>Help getting set up, or a password reset email that did not arrive.</li>
        <li>
          A wrong card: say the game, the date, and what was said. If you can, attach the game log from Past games.
        </li>
        <li>A roster or stats sheet that would not import.</li>
        <li>
          Deleting data: you can delete your whole account from <Link href="/settings">Settings</Link>. A player or parent who
          wants a name removed can write to us with the school and the name.
        </li>
      </ul>
    </PublicPage>
  );
}
