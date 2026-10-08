import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps } from "react";

// =============================================================================
// The dashboard's buttons (docs/UI_STYLE.md). At most one primary per screen.
// A destructive button always confirms; the confirm is the caller's.
// =============================================================================

export type ButtonVariant = "primary" | "outlined" | "destructive";

const BASE =
  "inline-flex h-[30px] shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[3px] border text-[13px] transition-colors duration-100 " +
  "disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:font-medium disabled:text-disabled";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent px-[14px] font-semibold text-white hover:enabled:border-accent-hover hover:enabled:bg-accent-hover",
  outlined: "border-line-strong bg-surface px-3 font-medium text-ink hover:enabled:bg-press",
  destructive: "border-red bg-surface px-3 font-medium text-red hover:enabled:bg-red-fill",
};

/** A link drawn as a button never disables, so its hover needs no :enabled. */
const LINK_VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent px-[14px] font-semibold text-white hover:border-accent-hover hover:bg-accent-hover",
  outlined: "border-line-strong bg-surface px-3 font-medium text-ink hover:bg-press",
  destructive: "border-red bg-surface px-3 font-medium text-red hover:bg-red-fill",
};

export function buttonClass(variant: ButtonVariant = "outlined", extra = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${extra}`.trim();
}

export function Button({
  variant = "outlined",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

/** A link that looks like a button: New game on the home toolbar, Resume. */
export function ButtonLink({
  variant = "outlined",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={`${BASE} ${LINK_VARIANTS[variant]} ${className}`.trim()} {...props} />;
}

export const TEXT_LINK = "cursor-pointer text-accent hover:underline";

/** A plain text link. */
export function TextLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link className={`${TEXT_LINK} ${className}`.trim()} {...props} />;
}

/** A button that reads as a text link, for actions that are not navigation. */
export function LinkButton({
  className = "",
  tone = "accent",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "accent" | "red" }) {
  const color = tone === "red" ? "text-red" : "text-accent";
  return (
    <button
      type={type}
      className={`cursor-pointer whitespace-nowrap ${color} hover:underline disabled:cursor-not-allowed disabled:text-disabled disabled:no-underline ${className}`.trim()}
      {...props}
    />
  );
}

export type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement>;
