# Grok Is This True

Chrome Manifest V3 extension for desktop X that finds the post nearest the vertical center of the viewport and replies:

```text
@grok is this true?
```

This build uses the X account already logged into your browser session. There is no API key setup and no backend.

## What It Does

- shows a fixed `ASK GROK` launcher on `x.com` and `twitter.com`
- targets the post closest to the middle of the viewport
- sends immediately when you click the launcher
- uses X's native reply composer
- sends as the account currently logged into X in the browser
- lets you switch between three saved Grok reply prompts
- includes a native mute action for the centered post's author

## Requirements

- desktop Chrome or Chromium
- an active logged-in X session in the browser

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder.

## Use It

1. Open X in the same Chrome profile where the extension is loaded.
2. Make sure you are logged in to the account you want to reply from.
3. Scroll so the target post is near the middle of the viewport.
4. Click `ASK GROK`.

The extension clicks X's native reply button, fills `@grok is this true?`, and submits the reply through the browser session.

Use the gear button to switch the reply prompt:

- `@grok is this true?`
- `@grok is this ai?`
- `@grok is this real?`

Use the mute icon in the launcher toolbar to mute the centered post's author through X's native menu.

## Files

- `manifest.json`: MV3 manifest and content script wiring
- `content.js`: overlay UI, centered-post targeting, native reply automation, prompt selection, and mute flow
- `content.css`: launcher and toast styling
- `assets/button-icon.png`: launcher artwork
- `assets/button-icon.svg`: editable source artwork

## Notes

- tweet targeting depends on X's live DOM and may need updates if X changes its markup
- replies are sent through X's native web UI, not the X API
- the active browser account decides who the reply is posted as
- muting also uses X's native web UI
- validation is currently manual
