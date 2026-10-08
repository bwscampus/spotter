// =============================================================================
// Who and where Spotter is, in one place, for the public pages, the header,
// the metadata and the notes that say how to reach a person.
// =============================================================================

/** The site's name, which is also its domain. */
export const SITE_NAME = "The Spotting Board";

/** The app's name, on screen and in tab titles. */
export const APP_NAME = "Spotter";

export const SITE_URL = "https://thespottingboard.com";

/** The one address for help, a wrong card, or deleting data. */
export const CONTACT_EMAIL = "thespottercommunications@gmail.com";

export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

/** What Spotter does, in one sentence: the landing page and the link previews. */
export const TAGLINE =
  "Spotter puts a player's card on screen the moment a high school announcer says their name or cued jersey number.";

/** The pages anyone can open, signed in or not. */
export const PUBLIC_PAGES = ["/", "/privacy", "/terms", "/contact"] as const;
