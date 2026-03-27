# Grok Is This True

Chrome Manifest V3 extension for desktop X that finds the post nearest the vertical center of the viewport and replies:

```text
@grok is this true?
```

This build is meant for technical users who bring their own X Developer app and local OAuth 1.0a credentials.

## What It Does

- shows a fixed `ASK GROK` launcher on `x.com` and `twitter.com`
- targets the post closest to the middle of the viewport
- sends immediately when you click the launcher
- stores your OAuth 1.0a keys locally in Chrome storage on your machine
- lets you replace keys or disconnect from the settings popover

## Requirements

- desktop Chrome or Chromium
- an X Developer app with `Read and write` access
- your own OAuth 1.0a:
  - Consumer Key
  - Consumer Secret
  - Access Token
  - Access Token Secret

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder.

## Configure X Keys

1. Open the extension on X.
2. Paste your OAuth 1.0a credentials into the auth card.
3. Click `Save Keys`.
4. Use the gear button to replace keys later or disconnect.

The extension does not use a backend. Secrets are not committed to the repo and are not sent anywhere except X API requests from the extension.

## X Developer Setup

In X Developer Console:

1. Create or use an app under your project.
2. Set app permissions to `Read and write`.
3. Generate OAuth 1.0a consumer keys.
4. Generate an OAuth 1.0a access token for the account you want the extension to post as.
5. Make sure your project has active API access and credits.

## Files

- `manifest.json`: MV3 manifest and permissions
- `background.js`: local OAuth 1.0a credential storage and signed `POST /2/tweets` requests
- `content.js`: overlay UI, settings form, centered-post targeting, and send flow
- `content.css`: launcher, settings, modal, and toast styling
- `assets/button-icon.png`: launcher artwork
- `assets/button-icon.svg`: editable source artwork

## Notes

- tweet targeting depends on X's live DOM and may need updates if X changes its markup
- this is a bring-your-own-keys tool, not a consumer login flow
- one browser profile stores one active credential set at a time
- you are responsible for complying with X's API terms and usage limits
- validation is currently manual
