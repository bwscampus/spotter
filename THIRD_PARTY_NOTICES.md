# Third-party notices

Spotter ships these packages to the browser under licenses other than MIT. Everything else it ships is MIT.

| Package | License | Source | How Spotter uses it |
|---|---|---|---|
| heic-to | LGPL-3.0 | https://github.com/hoppergee/heic-to | Loaded only when an iPhone photo (HEIC) is dropped on an import, to turn it into a JPEG in the browser. It is not modified, and it is loaded as its own file, so it can be replaced. |

Not legal advice: a lawyer should confirm what LGPL-3.0 asks of a web app that serves the library to browsers.

## Data

| Data | License | Source | How Spotter uses it |
|---|---|---|---|
| SecLists `Passwords/Common-Credentials/10k-most-common.txt` (part of it) | MIT, Copyright (c) 2018 Daniel Miessler | https://github.com/danielmiessler/SecLists | On the server only (`lib/server/commonPasswords.ts`): a new password on the list is refused at sign-up and reset. |
