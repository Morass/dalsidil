# Další díl

Další díl shows what comes next in series you rate on ČSFD. It reads episode ratings from your profile and keeps a small, clickable list in the browser toolbar.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select this folder.
5. Pin **Další díl** to the toolbar.

## Quick start

Sign in to ČSFD normally, then open the extension. Další díl identifies the account from ČSFD's signed-in header and starts scanning it automatically. It never receives your password. If automatic detection is unavailable, open **Settings** and paste the address of your ČSFD profile, such as `https://www.csfd.cz/uzivatel/123-name/`.

The first scan may continue in small batches if your ratings history is long. You can close the popup; progress is saved.

The list is ordered by the most recent episode-rating activity. Each row shows the furthest normally numbered episode you rated and links to ČSFD's following episode. Finished series are left out. The default list has 10 series; open **Settings** to choose 1–25.

On ČSFD pages, the **Další díl** button in the upper-right corner opens the same cached list without starting a scan. The toolbar popup remains available everywhere and is where you refresh or change settings.

Use **↻** to check for new ratings. Settings also has **Full rescan**, which reconciles removed ratings and rebuilds progress from the complete history. If ČSFD asks for a browser check, open ČSFD normally, complete it, and refresh the extension again.

## What it touches

Další díl contacts only `www.csfd.cz` and `www.csfd.sk`. It reads the signed-in header plus profile-rating and episode pages using your normal browser session. It does not read or store your ČSFD password or cookies. Derived progress, settings, and cached links stay in Chrome's local extension storage. It has no analytics, server, API key, or separate account.

It never changes ratings or other ČSFD data.

## Limits

- A vote is treated as evidence of progress; unrated watched episodes cannot be inferred.
- Once progress for a series has been established, rating an older episode later makes the series recent but does not move progress backward. On the first-ever scan, ČSFD's ratings table omits S/E labels, so an unusual late vote on an older episode can initially be taken as the current position.
- Deleted ratings are noticed by a full rescan, not necessarily by the next short refresh.
- Specials without normal S/E numbering follow ČSFD's own navigation where possible.
- Page-layout changes or ČSFD's bot check can temporarily stop a refresh. Cached results remain available.

## Licence

[MIT](LICENSE)
