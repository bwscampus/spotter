"use client";

import { useEffect } from "react";
import { installErrorReporter } from "@/lib/errors/report";

/** Installs the crash reporter once, from the root layout. Draws nothing. */
export function ErrorReporter() {
  useEffect(() => installErrorReporter(), []);
  return null;
}
