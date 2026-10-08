// Draft, pending legal review.

import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicPage";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/ui/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using Spotter.",
};

export default function Terms() {
  return (
    <PublicPage title="Terms of use" updated="October 6, 2026">
      <p>
        These terms cover your use of Spotter at thespottingboard.com. By creating an account you agree to them. If you do
        not agree, do not use Spotter.
      </p>

      <h2>What Spotter is for</h2>
      <p>
        Spotter helps you prepare and call your own broadcasts of high school games: it reads rosters, listens while you
        call, and shows player cards. Use it for that.
      </p>

      <h2>What you upload</h2>
      <ul>
        <li>
          You must have the right to use any roster, stats sheet or other file you upload or paste, for your broadcast.
          Before your first import, Spotter asks you to confirm this.
        </li>
        <li>Do not upload anything you are not allowed to share, or anything unrelated to calling a game.</li>
        <li>You are responsible for the rosters and stats you save and for how you use them on air.</li>
      </ul>

      <h2>What you may not do</h2>
      <ul>
        <li>Do not publish, sell or share play-by-play, stats or rosters that Spotter extracts or works out.</li>
        <li>Do not try to reach other accounts&apos; data, get around the account review, or overload the service.</li>
        <li>Do not use Spotter to harass or single out a player.</li>
      </ul>

      <h2>No warranty</h2>
      <p>
        Spotter is provided as it is. It can show the wrong card, miss a name, or get a number wrong, and live stats in
        particular can be wrong. Check anything before you say it on air. We are not responsible for mistakes made on a
        broadcast, or for a game the service was down for.
      </p>

      <h2>Accounts</h2>
      <p>
        We can suspend or close an account, for example if these terms are broken or the service is misused. You can
        delete your account at any time from{" "}
        <Link href="/settings">Settings</Link>. The <Link href="/privacy">privacy policy</Link> says what that deletes.
      </p>

      <h2>Changes</h2>
      <p>We may change these terms. The date at the top says when they last changed.</p>

      <h2>Contact</h2>
      <p>
        <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>
      </p>
    </PublicPage>
  );
}
