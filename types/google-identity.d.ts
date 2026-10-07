// The slice of Google Identity Services (https://accounts.google.com/gsi/client)
// that the sign-in button uses. Kept local rather than pulling in
// @types/google-one-tap for four calls.

declare namespace google.accounts.id {
  interface CredentialResponse {
    /** The signed ID token (a JWT). */
    credential?: string;
    select_by?: string;
  }

  interface IdConfiguration {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    context?: "signin" | "signup" | "use";
    use_fedcm_for_prompt?: boolean;
    use_fedcm_for_button?: boolean;
    itp_support?: boolean;
  }

  interface GsiButtonConfiguration {
    type?: "standard" | "icon";
    theme?: "outline" | "filled_blue" | "filled_black";
    size?: "large" | "medium" | "small";
    text?: "signin_with" | "signup_with" | "continue_with" | "signin";
    shape?: "rectangular" | "pill" | "circle" | "square";
    logo_alignment?: "left" | "center";
    /** Pixels, between 200 and 400. */
    width?: number;
    locale?: string;
  }

  function initialize(config: IdConfiguration): void;
  function renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void;
  function prompt(): void;
  function cancel(): void;
  function disableAutoSelect(): void;
}
