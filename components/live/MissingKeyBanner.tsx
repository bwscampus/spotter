"use client";

import { OUR_SIDE_MESSAGE, SPEECH_NOT_SET_UP_MESSAGE } from "@/lib/messages";

/**
 * Speech recognition has no key on the server. The server's own log says
 * which key and where (app/live/page.tsx); the screen says only what the
 * announcer can do about it.
 */
export function MissingKeyBanner() {
  return (
    <div role="alert" className="border-b-4 border-red-400 bg-red-600 px-6 py-4 text-center">
      <p className="text-2xl font-black text-white">{SPEECH_NOT_SET_UP_MESSAGE}</p>
      <p className="mt-1 text-sm font-medium text-red-100">
        {OUR_SIDE_MESSAGE} The mic and the level meter still work; name spotting is off until it is fixed.
      </p>
    </div>
  );
}
