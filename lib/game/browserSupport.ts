// =============================================================================
// Can this browser call a game? (pre-launch audit H13.) The first thing a
// stranger is likely to do is open Spotter's link inside TikTok or Instagram on
// a phone, where the mic, the audio worklet or Google sign-in do not work and
// the errors that come back mean nothing to them. This says plainly what is
// missing before they press Listen.
//
// Pure: readBrowserFacts gathers what the page can see once, and
// browserSupport decides from those facts alone, so every case can be tested
// without a browser.
// =============================================================================

/** What the page can see about where it is running. */
export interface BrowserFacts {
  /** https, or localhost: browsers allow the mic only in a secure context. */
  secureContext: boolean;
  /** navigator.mediaDevices.getUserMedia exists. */
  getUserMedia: boolean;
  /** AudioWorkletNode exists: how audio reaches speech recognition. */
  audioWorklet: boolean;
  /** WebSocket exists: the connection to speech recognition. */
  webSocket: boolean;
  /** navigator.wakeLock exists: keeps the screen awake. A warning only. */
  wakeLock: boolean;
  userAgent: string;
  /** The primary pointer is a finger: (pointer: coarse). */
  coarsePointer: boolean;
  /** The screen's shorter side, in CSS pixels. */
  screenShortSide: number;
  /** navigator.maxTouchPoints, which tells an iPad that says it is a Mac apart from a Mac. */
  maxTouchPoints: number;
}

/** Something that stops a game being called here. */
export type Blocker = "insecure" | "no_microphone_access" | "no_audio_worklet" | "no_websocket" | "phone_or_tablet" | "in_app_browser";

/** Something that makes a game worse here, but does not stop it. */
export type Caution = "no_wake_lock";

/** The apps whose built-in browsers people open links in. */
export type InAppBrowser = "TikTok" | "Instagram" | "Facebook" | "Snapchat" | "LinkedIn";

export interface BrowserSupport {
  blockers: Blocker[];
  cautions: Caution[];
  /** The app whose browser this is, when it is one. */
  inApp: InAppBrowser | null;
}

/** The screen's shorter side under this, with a finger for a pointer, is a phone or a small tablet. */
export const SMALL_SCREEN_PX = 900;

/** The line at the top of the box. */
export const NEEDS_LINE = "Spotter needs Chrome or Edge on a laptop or desktop with a microphone.";

/** What each blocker means, in plain words. */
export const BLOCKER_WORDS: Record<Blocker, string> = {
  insecure: "This page is not on a secure (https) address, so the browser will not share the microphone.",
  no_microphone_access: "This browser cannot use a microphone.",
  no_audio_worklet: "This browser cannot send audio to speech recognition.",
  no_websocket: "This browser cannot keep a live connection open.",
  phone_or_tablet: "This looks like a phone or tablet.",
  in_app_browser: "This is an app's built-in browser.",
};

export const CAUTION_WORDS: Record<Caution, string> = {
  no_wake_lock: "This browser cannot keep the screen awake. Set this computer to never sleep while you call.",
};

/** How to get out of an app's browser. */
export const IN_APP_LINE = "Open this page in Chrome (tap ⋯ then Open in browser).";

// Each app marks its built-in browser in the user agent.
const IN_APP_MARKERS: Array<[InAppBrowser, RegExp]> = [
  ["TikTok", /\b(musical_ly|BytedanceWebview|TikTok)\b/i],
  ["Instagram", /\bInstagram\b/i],
  ["Facebook", /\b(FBAN|FBAV|FB_IAB|FBIOS)\b/],
  ["Snapchat", /\bSnapchat\b/i],
  ["LinkedIn", /\bLinkedInApp\b/i],
];

export function inAppBrowser(userAgent: string): InAppBrowser | null {
  for (const [app, marker] of IN_APP_MARKERS) if (marker.test(userAgent)) return app;
  return null;
}

/** A phone or tablet: says so in its user agent, is an iPad calling itself a Mac, or has a finger for a pointer and a small screen. */
export function isPhoneOrTablet(facts: Pick<BrowserFacts, "userAgent" | "coarsePointer" | "screenShortSide" | "maxTouchPoints">): boolean {
  const ua = facts.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobi|Silk|Kindle/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && facts.maxTouchPoints > 1) return true;
  return facts.coarsePointer && facts.screenShortSide > 0 && facts.screenShortSide < SMALL_SCREEN_PX;
}

export function browserSupport(facts: BrowserFacts): BrowserSupport {
  const inApp = inAppBrowser(facts.userAgent);
  const blockers: Blocker[] = [];
  if (inApp) blockers.push("in_app_browser");
  if (isPhoneOrTablet(facts)) blockers.push("phone_or_tablet");
  if (!facts.secureContext) blockers.push("insecure");
  if (!facts.getUserMedia) blockers.push("no_microphone_access");
  if (!facts.audioWorklet) blockers.push("no_audio_worklet");
  if (!facts.webSocket) blockers.push("no_websocket");
  const cautions: Caution[] = facts.wakeLock ? [] : ["no_wake_lock"];
  return { blockers, cautions, inApp };
}

/**
 * What this browser can see about itself. Browser only: call it after the
 * page has mounted, never on the server.
 */
export function readBrowserFacts(): BrowserFacts {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const scr = typeof screen === "undefined" ? undefined : screen;
  let coarsePointer = false;
  try {
    coarsePointer = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    coarsePointer = false;
  }
  return {
    secureContext: typeof isSecureContext === "boolean" ? isSecureContext : false,
    getUserMedia: typeof nav?.mediaDevices?.getUserMedia === "function",
    audioWorklet: typeof AudioWorkletNode === "function",
    webSocket: typeof WebSocket === "function",
    wakeLock: Boolean(nav && "wakeLock" in nav),
    userAgent: nav?.userAgent ?? "",
    coarsePointer,
    screenShortSide: scr ? Math.min(scr.width, scr.height) : 0,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
  };
}
