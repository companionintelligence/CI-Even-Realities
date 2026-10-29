# CI Companion for Even Realities G2: product video storyboard

> **Private & Confidential, Property of Lifescope Inc. Do not distribute.**

`storyboard.json` is the whole film. Both cuts (16:9 and 9:16) are built from it with the `ci-video`
kit (video-kit 0.35.0). Videos are build output and are not committed.

## Footage honesty

- The two pictures are the committed phone WebView captures `ci-glasses-app/assets/screenshots/01-empty-quick-actions.png`
  and `06-chat-with-response.png`, shown whole and unedited. Every frame carries the pill
  "Phone app captures. No glasses footage."
- **Hardware-footage gaps, stated plainly:**
  1. No footage of G2 glasses or of the HUD. The "ask" and "approve" scenes are type cards backed by
     `docs/store-listing.md` and the README, not by a picture.
  2. **The three committed HUD captures are unusable.** `02-hud-ready.png`, `04-hud-prompt.png` and
     `05-hud-stream.png` are 576x288 images that are 100 percent solid `#00ff00` (checked pixel by
     pixel). They were not used, and they are still listed in `docs/store-listing.md` as store
     screenshots. That defect belongs in the product and is not masked here.
  3. `03-settings.png` was left out: its Quick-connect cards print `localhost:8787` endpoints where a
     product address belongs. Re-shoot with a real Hub host before using it.
- Copy comes from `README.md` and `docs/store-listing.md`. The app is not published, so the film does not
  say it is in the Even Hub store.
