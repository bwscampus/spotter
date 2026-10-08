import { describe, expect, it } from "vitest";
import { browserSupport, inAppBrowser, isPhoneOrTablet, type BrowserFacts } from "@/lib/game/browserSupport";

// =============================================================================
// The browser check (pre-launch audit H13): what stops a game being called in
// this browser, from what the page can see. Pure, so every case is a fact list.
// =============================================================================

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const TIKTOK_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US BytedanceWebview/d8a21c6";
const INSTAGRAM_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android";
const FACEBOOK_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;FBBV/1]";
const SNAPCHAT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.10.0.40";
const LINKEDIN = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1";

function laptop(over: Partial<BrowserFacts> = {}): BrowserFacts {
  return {
    secureContext: true,
    getUserMedia: true,
    audioWorklet: true,
    webSocket: true,
    wakeLock: true,
    userAgent: CHROME_MAC,
    coarsePointer: false,
    screenShortSide: 900,
    maxTouchPoints: 0,
    ...over,
  };
}

describe("the browser check", () => {
  it("passes Chrome on a Mac and Edge on Windows with nothing to say", () => {
    expect(browserSupport(laptop())).toEqual({ blockers: [], cautions: [], inApp: null });
    expect(browserSupport(laptop({ userAgent: EDGE_WINDOWS, screenShortSide: 1080 }))).toEqual({ blockers: [], cautions: [], inApp: null });
  });

  it("names each missing piece", () => {
    expect(browserSupport(laptop({ secureContext: false })).blockers).toEqual(["insecure"]);
    expect(browserSupport(laptop({ getUserMedia: false })).blockers).toEqual(["no_microphone_access"]);
    expect(browserSupport(laptop({ audioWorklet: false })).blockers).toEqual(["no_audio_worklet"]);
    expect(browserSupport(laptop({ webSocket: false })).blockers).toEqual(["no_websocket"]);
  });

  it("calls a missing wake lock a caution, not a blocker", () => {
    expect(browserSupport(laptop({ wakeLock: false }))).toEqual({ blockers: [], cautions: ["no_wake_lock"], inApp: null });
  });

  it("knows a phone or tablet by its user agent, an iPad calling itself a Mac, or a finger on a small screen", () => {
    expect(isPhoneOrTablet(laptop({ userAgent: IPHONE_SAFARI }))).toBe(true);
    expect(isPhoneOrTablet(laptop({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }))).toBe(true);
    expect(isPhoneOrTablet(laptop({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)", coarsePointer: true, screenShortSide: 412 }))).toBe(true);
    // A touchscreen laptop: a mouse for its main pointer, so not a tablet.
    expect(isPhoneOrTablet(laptop({ userAgent: EDGE_WINDOWS, maxTouchPoints: 10, screenShortSide: 800 }))).toBe(false);
    // A Mac with no touch is a Mac.
    expect(isPhoneOrTablet(laptop({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 }))).toBe(false);
    expect(browserSupport(laptop({ userAgent: IPHONE_SAFARI, screenShortSide: 390 })).blockers).toEqual(["phone_or_tablet"]);
  });

  it("knows the apps people open links in", () => {
    expect(inAppBrowser(TIKTOK_IOS)).toBe("TikTok");
    expect(inAppBrowser(INSTAGRAM_ANDROID)).toBe("Instagram");
    expect(inAppBrowser(FACEBOOK_IOS)).toBe("Facebook");
    expect(inAppBrowser(SNAPCHAT)).toBe("Snapchat");
    expect(inAppBrowser(LINKEDIN)).toBe("LinkedIn");
    expect(inAppBrowser(CHROME_MAC)).toBeNull();
    expect(inAppBrowser(IPHONE_SAFARI)).toBeNull();
  });

  it("puts an app's browser first, with the phone after it", () => {
    const support = browserSupport(laptop({ userAgent: TIKTOK_IOS, coarsePointer: true, screenShortSide: 390, wakeLock: false }));
    expect(support.inApp).toBe("TikTok");
    expect(support.blockers).toEqual(["in_app_browser", "phone_or_tablet"]);
    expect(support.cautions).toEqual(["no_wake_lock"]);
  });

  it("lists everything that is missing at once", () => {
    const support = browserSupport({
      secureContext: false,
      getUserMedia: false,
      audioWorklet: false,
      webSocket: false,
      wakeLock: false,
      userAgent: "",
      coarsePointer: false,
      screenShortSide: 0,
      maxTouchPoints: 0,
    });
    expect(support.blockers).toEqual(["insecure", "no_microphone_access", "no_audio_worklet", "no_websocket"]);
  });
});
