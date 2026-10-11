// Draft, pending legal review.
//
// Every statement here describes what the code does today. When the code
// changes what is stored, where, or who reads it, change this page with it.

import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicPage";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/ui/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What StatCast stores, where it is kept, who processes it, and how to delete it.",
};

export default function Privacy() {
  return (
    <PublicPage title="Privacy policy" updated="October 6, 2026">
      <p>
        This page says what StatCast keeps, where it is kept, which companies process it for us, and how
        to delete it. We do not sell data and we do not show ads.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your account: your email address.</li>
        <li>
          The rosters you save: school, mascot and team colour, and for each player their name, jersey number, position,
          grade, height, weight, how the name is said, and the ways the speech service has written it.
        </li>
        <li>The season stats you import for those players.</li>
        <li>
          For each game you call: when it started, how long the microphone was on, and counts such as how many cards were
          shown. Not what was said.
        </li>
        <li>The feedback you give at the end of a game: a rating, the boxes you tick, and an optional short note.</li>
        <li>
          Usage analytics: which screens and buttons were used, with codes and counts only. Analytics never hold a player
          name, a jersey number, anything that was said, or anything from a file you uploaded.
        </li>
        <li>
          Crash reports: the error&apos;s name, the first line of its message, the page it happened on, and when. Kept 90
          days.
        </li>
      </ul>
      <p>
        We never keep the files you upload. A roster or stats file is read in memory to pull out the players, then dropped.
        We never record audio.
      </p>

      <h2>Where it is kept</h2>
      <ul>
        <li>
          Your account, rosters, stats, game counts, feedback, analytics and crash reports are kept in a database run by
          Railway, in the United States. Each account can read only its own data. If you sign up with an email and a
          password, only a scrambled form of the password (a hash) is kept, never the password itself.
        </li>
        <li>
          The game you have open, and a log of each game (the transcript of what the microphone heard, and which cards went
          up), are kept in your own browser on the laptop you call from. They are not sent to us, except the shared game log
          described below. You can download a game&apos;s log from Past games, and deleting a game there clears its log from
          that browser.
        </li>
      </ul>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <strong>Anthropic&apos;s Claude, through OpenRouter</strong>, reads the roster, season stats and other files you
          import, and the text you paste, to turn them into a list of players, their stats and storylines. Every request
          is routed only to providers that keep nothing and do not train on it (OpenRouter&apos;s zero data retention
          routing, with data collection denied). Nothing from that is kept by StatCast except what you save.
        </li>
        <li>
          <strong>Deepgram</strong> turns the microphone audio into text while you call a game. The audio is streamed and not
          recorded by StatCast, and we ask Deepgram not to use it to improve its models (their mip_opt_out setting). The
          surnames on tonight&apos;s rosters are sent with it as hints, so the names are heard correctly.
        </li>
        <li>
          <strong>Live stats</strong> (football, a beta that is off unless you turn it on): short windows of the transcript and
          both rosters are sent to Google&apos;s Gemini through OpenRouter, routed only to providers that keep nothing and do
          not train on it (OpenRouter&apos;s zero data retention routing, with data collection denied).
        </li>
        <li>
          <strong>Google</strong>, if you choose to sign in with Google, tells us your email address.
        </li>
        <li>
          <strong>Resend</strong> sends the emails StatCast sends you (confirming your address, resetting your password).
          It receives your email address and the email itself.
        </li>
        <li>
          <strong>Railway</strong> hosts the site. Its logs from StatCast hold error codes, counts and timings, never roster
          content.
        </li>
      </ul>

      <h2>The shared game log</h2>
      <p>
        To find where name spotting goes wrong in real games, StatCast sends a scrubbed copy of a game&apos;s log when the
        game ends. This is on by default. You can turn it off on the game setup screen, or from the live screen&apos;s menu
        until the game ends.
      </p>
      <ul>
        <li>
          It keeps players&apos; last names as they were said and spelled, how each name is meant to be said, and the
          transcript, so a mistake can be read against the name.
        </li>
        <li>
          It replaces first names and school names with tags such as [H22] (home team, number 22). A first name that is on
          neither roster can slip through, because the transcript has no capital letters to find it by.
        </li>
        <li>It has no audio, no game id, and times only as offsets from the start of the game.</li>
        <li>
          It is stored with a one-way code made from your account id, so it can be deleted with your account. It is kept 90
          days, then deleted, and only we can read it.
        </li>
      </ul>

      <h2>Players and parents</h2>
      <p>
        Rosters name high school players, many of them under 18. The announcer who saves a roster is responsible for having
        the right to use it. If you are a player or a parent and want a name removed, write to{" "}
        <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> with the school and the name, and we will remove it.
      </p>

      <h2>Cookies and browser storage</h2>
      <p>
        StatCast uses one sign-in cookie to keep you signed in. It uses your browser&apos;s storage for the open game, the
        game logs and a few settings. There are no advertising or tracking cookies.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Go to <Link href="/settings">Settings</Link> and choose Delete my account. That deletes your account and everything
        stored with it: rosters, stats, game counts, feedback, analytics, crash reports and your shared game logs. It also
        clears the open game and game logs in the browser you delete it from. Logs kept in another browser stay there until
        you clear that browser. You can also delete a single team or a single game at any time.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about your data: <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>.
      </p>
    </PublicPage>
  );
}
