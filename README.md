# PC4

A game library for Windows in the spirit of Playnite, with a console mode modelled on the PS4 home screen.

## Run it

```
npm install
npm start               # opens in the mode chosen in Settings (Desktop by default)
npm run fullscreen      # opens straight into Console Mode
```

Or double-click `Start PC4.bat` / `Start PC4 (Console Mode).bat`.
`npm run dist` builds a Windows installer into `dist/`.

## Modes

**Desktop Mode** is laid out like Playnite's desktop app: a sidebar (main menu, Library, Statistics, Controller Test), a top panel with search, filter presets, grouping, sorting, Grid / Details / List views, random game, the explorer and filter panels and notifications, and your controller with its battery in the top-right corner. Games get Playnite's completion status, a user score and notes. Keys: F11 Console Mode, F5 update library, F3 edit, Ctrl+Shift+F search everything, Ctrl+R random game.

**Console Mode** is the fullscreen, controller-friendly PS4-style UI:

- Home row of square tiles, sorted by what you played last. The selected tile grows, shows its name and a *Start* bar, and the game's art fades in behind it.
- Press **Down** for the game hub (Start, Information, Play Time, Details, Favorite, Link Artwork).
- Press **Up** for the function area (Game Import, Notifications, Profile, Library, Settings, Desktop Mode, Power).
- Other screens: the Library app, Settings, folders, the OPTIONS side menu, notifications in the top-left corner, an on-screen keyboard, a startup animation and a user-select screen.
- Built-in themes (Classic Blue, Midnight, Crimson, Emerald, Violet, Sunset, Silver, Black) with animated waves and particles.

| Action | Controller | Keyboard |
|---|---|---|
| Move | D-pad / left stick | Arrow keys |
| Select / Start | ✕ (A) | Enter |
| Back | ○ (B) | Esc / Backspace |
| Options menu | OPTIONS (Menu) | Tab |
| Library sort / search | △ (Y) | Y |
| Home | PS / Guide | Home |
| Jump | L1 / R1 | Page Up / Down |

## PS5 style

Settings > Themes > **Console Style** switches Console Mode between the PS4 and PS5 look (also in Desktop Mode > Settings). PS5: Games / Media tabs (L1 / R1), a row of small rounded icons with the focused one big and its name under the icons beside it, **Explore** (news, the story in focus over its picture with cards along the bottom), the game's art filling the screen with its logo, **Play** and **···** (OPTIONS), cards along the bottom (press down), and Search, Settings, your avatar (Profile, Notifications, Xbox emulation, Controller Test, Desktop Mode, Power) and the clock in the top-right corner. A game's theme song plays as soon as it's selected (PS5 "Home Screen Music").
Each style has its own sounds: a **PS4** and a **PS5** folder inside the sound folder (or files named `ps4-<name>` / `ps5-<name>`). A sound a style doesn't have uses PC4's built-in one; the styles never borrow each other's sounds. PS5 home music: `theme.*` in the PS5 folder; without it the home screen is quiet, like a real PS5.

## Adding games

- **Scan launchers**: Steam, Epic Games and GOG Galaxy installs are found automatically.
- **Add a game**: pick any `.exe`, `.lnk` or Steam `.url` shortcut. In Desktop Mode you can also drag one onto the window.
- **Artwork**: PC4 matches each game on the Steam store and downloads its cover, background (hero), logo, icon and description. You don't need an API key for this. Use *Link Artwork* / *Download metadata* to choose a different match. If you add a free SteamGridDB API key in Settings, you get community covers, square console tiles, logos and icons to choose from.

## Play time

PC4 watches for processes running from the game's install folder. That's how it tracks play time for games started through Steam or Epic too. When the game closes, PC4 comes back to the front and shows how long you played.

## Sounds, music and font (make it feel like your PS4)

PC4 can't ship Sony's actual sounds, music or font, but it uses your own copies automatically:

- **Sound effects**: files in `sounds/` or `assets/sounds/` named `navigate`, `select`, `back`, `options`, `error`, `notification`, `trophy`, `launch`, `boot`, `login`, `shutdown`, `keyboard` (any of .wav/.mp3/.ogg/...). PS4-style names like `ps4-select-button.mp3` or `ps4-menu-intro.mp3` are recognised as-is. Missing sounds use PC4's built-in versions.
- **Music**: `assets/music/theme.*` (or any file in `sounds/`/`music/` with "home menu" or "theme" in its name) loops on the home screen; `intro.*` plays on the startup/user screen.
- **Game theme songs**: each game can have its own song that crossfades in when you open its details. Pick a file per game, or install [yt-dlp](https://github.com/yt-dlp/yt-dlp) (`winget install yt-dlp`) and PC4 finds them automatically. With yt-dlp you can also **Search Online** (YouTube results with previews: □ plays a preview, ✕ uses the song) or **Paste a YouTube Link** (a link on the clipboard is filled in for you). Find these under the game's Theme Song card, OPTIONS > Theme Song, or Edit Game Details > Theme Song.
- **Font**: put the SST font files in `assets/fonts/` (weights are read from the file names) and the whole UI uses them.
- **Wallpaper**: Settings > Themes > Custom Wallpaper takes an image or a video (e.g. a recording of a PS4 dynamic theme).
- **Game Wallpaper**: shows a game's full-screen art only in its details (default), as soon as the tile is selected, or never. Wallpapers are the 3840-wide Steam key art; in Desktop Mode you can also pick any 1080p Steam screenshot.

## What's New

Shows official news for the games in your library (from Steam, refreshed every 45 minutes), your play activity, and your own posts. Post with OPTIONS on What's New, Settings > What's New, or Desktop Mode > Add games > Post to What's New.

## Game details layout

Pressing down on a game shows its details. They scroll vertically by default; Settings > Themes > Game Details Layout switches back to the horizontal row.

## Console controls and editing

- Button hints show controller icons when you use a controller and keyboard keys when you use the keyboard; they switch automatically. Settings > Controllers > **Button Icons** picks the controller style: Automatic (follows the controller plugged in), PlayStation 4, PlayStation 5 (white DualSense icons) or Xbox (A B X Y, LB/RB…).
- **YouTube**: the YouTube tile at the end of the home row opens YouTube's TV app inside PC4. ✕ select, ○ back, □ play/pause, △ search, L2/R2 jump 10 seconds, L1/R1 previous/next video, PS button (Xbox: View button, keyboard: F1) goes back to PC4. Sign in with the code it shows on your phone. Thumbnails and channel pictures are swapped for YouTube's HD versions so they stay sharp; "Mute All Sound" also mutes YouTube. Hide the tile in Settings > Library.
- The on-screen keyboard follows the PS4 layout (L2 shift, L2+Triangle symbols, L3 accents, Triangle space, Square backspace, L1/R1 move the cursor, R2 done). Typing on a real keyboard hides it.
- OPTIONS on a game > **Edit Game Details** (or the card in the game's details): rename, edit info, and change every image (icon, cover, tile, banner, wallpaper, logo) from your PC, a link, or an online search. Theme songs live there too.
- Profile name and avatar: OPTIONS on the "Who's using this controller?" screen, the Profile page, or Settings > Profile. Avatars can come from your PC or from your games' art.
- Launch animation: PS4 (the home screen fades out and the game's splash fades in) or Zoom Tile, in Settings > Themes.
- **Keyboard** (Settings > Keyboard): every controller button has keys, and you can change them. Out of the box: arrows or W A S D move, Enter/Space ✕, Esc/Backspace ○, Y/T △, Del/X □, Tab/F2 OPTIONS, Home/F1 PS button, F3 Quick Menu, PgUp/Q L1, PgDn/E R1, [ and ] L2/R2, F8 SHARE (screenshot). Choose a row, then Change Key or Add Another Key and press the key. Shortcuts that work during games too: Ctrl+Alt+F3 Quick Menu over the game, Ctrl+Alt+Home back to PC4, Ctrl+Alt+S screenshot, Ctrl+Alt+R record (all changeable; combinations that type a character, like AltGr+Q = @ on a Turkish keyboard, aren't accepted).

## Controllers

- **Xbox Controller Emulation** (function area, or Settings > Controllers): makes a DUALSHOCK 4 / DualSense look like an Xbox 360 controller to games, like DS4Windows. Off / Always On / Only While Playing, stick deadzones, anti-deadzone, response curve, trigger deadzone, touchpad click, vibration strength, light bar battery colour. Needs the ViGEmBus driver (install button inside); HidHide (optional) hides the real controller from games so they don't see two.
- **Controller Test** (function area, or the sidebar in Desktop Mode, where the mouse works too): live diagram, stick drift and circularity, trigger range, every button, vibration test (OPTIONS), update rate, battery/touchpad/motion. Hold ○ or the PS button to leave.

## Secure Connection (Cloudflare WARP)

Settings > Network turns on **Cloudflare WARP** (free, from Cloudflare) so games and sites blocked by your internet provider work again, like Roblox in Turkey. Turn it on for a game with OPTIONS on the game > **Secure Connection**: PC4 connects before the game starts and disconnects when it closes (if PC4 turned it on). It's also a switch in the Quick Menu. WARP must be installed (there's an install button); all of the PC's traffic goes through Cloudflare while it's on.

## Quick Menu, music and captures

- **Hold PS** (or Xbox Guide, or F3) for the Quick Menu — also during a game: the game you're playing (go back / close), music (YouTube Music search, play/pause/skip), system volume and mute, Xbox emulation, controller battery, captures and power. Turn it off in Settings > Controllers.
- **SHARE**: press for a screenshot, hold to start/stop recording a clip (with sound). Keyboard: Ctrl+Alt+S / Ctrl+Alt+R. Saved in Pictures\PC4 Captures\<game>; browse them in the **Capture Gallery**.
- **Game Store**: Epic's free games this week and next, Steam deals, top sellers, new releases and most played.
- **Media Player**: videos and music from Videos, Music, Downloads and folders you add. Videos continue where you stopped.
- **Theme Changes** (Settings > Themes): with the time of day, or the colours and slowly moving wallpaper of your last played game.

## Performance

Settings > System > Performance: Automatic picks **Light** on older PCs (4 or fewer CPU threads, 8 GB memory or less, no graphics acceleration): no blur, a calmer background that pauses while PC4 isn't the active window. On a hard disk PC4 also writes less often.

## Data

The library, settings and downloaded artwork are stored in `%APPDATA%\PC4\pc4-data\`.
