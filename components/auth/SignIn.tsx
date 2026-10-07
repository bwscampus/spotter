"use client";

import { useState } from "react";
import { GoogleSignIn } from "./GoogleSignIn";

/** The sign-in screen: Google's button and whatever went wrong last. */
export function SignIn() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <p className="text-center text-sm text-neutral-600">Sign in with your Google account.</p>
      <GoogleSignIn onError={setError} />
      {error && (
        <p role="alert" className="text-center text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
