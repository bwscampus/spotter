"use client";

import { useEffect } from "react";
import { MISSING_KEY_MESSAGE } from "@/lib/messages";

export function MissingKeyBanner() {
  useEffect(() => {
    console.error(MISSING_KEY_MESSAGE);
  }, []);

  return (
    <div role="alert" className="border-b-4 border-red-400 bg-red-600 px-6 py-4 text-center">
      <p className="text-2xl font-black text-white">{MISSING_KEY_MESSAGE}</p>
      <p className="mt-1 text-sm font-medium text-red-100">
        Mic capture and the level meter still work. Transcription and name spotting are off until the key is added.
      </p>
    </div>
  );
}
