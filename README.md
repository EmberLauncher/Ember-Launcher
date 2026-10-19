# Ember Launcher

A Minecraft: Java Edition launcher for Windows, built with Electron. Ember keeps your game profiles in one place, launches Vanilla and Fabric, shows your skin, lets you switch capes, and can host a Minecraft server on your own computer.

> **Status:** early version (0.7). Things will change.

*Ember is an unofficial launcher. It is not approved by or associated with Mojang, Microsoft, or Minecraft.*

## Features

- **Profiles with world photos.** Each profile has its own game folder. Set a photo yourself, or Ember uses your newest screenshot (press F2 in game) after you play.
- **Play and Join.** Launch Vanilla or Fabric. Ember downloads the game files, libraries, assets and Java for you.
- **Quick-join server list.** Star servers to pin them, and Ember remembers what you played recently.
- **Microsoft sign-in.** Uses Microsoft's device code flow. Ember never sees your password.
- **Skin preview and cape switching.** See your skin and change your active cape from inside Ember.
- **Offline mode.** No sign-in needed, just choose a username (see below).
- **Host a server.** Run a Minecraft server on your own PC, with a console, whitelist, backups and a [playit.gg](https://playit.gg) tunnel helper so friends can join.
- **Color customization.** Pick presets or set your own accent, action and background colors.

Forge and NeoForge are not supported yet. Vanilla and Fabric are.

## Run it

1. Install [Node.js](https://nodejs.org) (LTS).
2. In this folder, run `npm install`.
3. Run `npm start`.

To build an installer, run `npm run dist`. The installer appears in the `dist` folder. Windows will warn about an unknown publisher because the installer is not signed.

## How sign-in works

Ember signs players in with their own Microsoft account using the OAuth 2.0 **device code flow**:

1. Ember shows a short code and opens Microsoft's sign-in page in your browser.
2. You sign in on Microsoft's site. Ember never sees your password.
3. Ember exchanges the result with Xbox Live and Minecraft Services to get your Minecraft profile (name, UUID, skins and capes) and to check that your account owns Minecraft: Java Edition.

Privacy and security:

- Tokens stay in Ember's main process. The app window only ever receives your player name, skin and capes.
- The refresh token is stored encrypted with the operating system's secure storage (Electron `safeStorage`). If the computer cannot do that, Ember does not remember the sign-in.
- Ember has no backend server and does not collect analytics or personal data. It talks directly to Microsoft, Xbox Live, Minecraft Services, and the download sources listed below.
- Minecraft Services access is used to sign in, read your profile, and change your active cape.

### Microsoft app ID setup

Minecraft only lets approved apps sign players in. To use your own copy of Ember with Microsoft sign-in you need your own app ID, and Mojang has to approve it:

1. Register a free app in the Azure portal. For account types choose **Personal Microsoft accounts only**, and leave the redirect address empty.
2. Under **Authentication**, set **Allow public client flows** to **Yes** and save.
3. Ask Mojang to approve the app ID using their review form.
4. Paste the **Application (client) ID** into Ember on the Skins & capes page.

Ember also has a setup guide built in (Skins & capes, then **Open the setup guide**).

## Offline mode

Press **Play** without being signed in and Ember asks for a username (3 to 16 letters, numbers or underscores). You can also set or remove it on the Skins & capes page.

- Works for singleplayer and offline-mode servers.
- No skin or capes.
- Online servers, including servers hosted in Ember, will not let offline players in.
- Each username gets the same player ID that vanilla Minecraft gives offline players, so worlds stay consistent.
- Signing in with Microsoft takes over. Signing out goes back to your offline username.

## Where Ember connects to

| Purpose | Service |
| --- | --- |
| Sign-in | Microsoft, Xbox Live and Minecraft Services |
| Game versions, libraries and assets | Mojang's download servers |
| Fabric | Fabric's metadata service |
| Java (when needed, 64-bit Windows) | Adoptium |
| Server tunnel helper | playit.gg agent, downloaded from its GitHub releases |
| Public IP lookup (only when you press the button) | ipify |

## Notes

- Ember downloads Java by itself when a game or server needs it (64-bit Windows).
- To back up a server, stop it first, then use **Back up to a folder**. Servers cannot run from Google Drive itself.
- You must own Minecraft: Java Edition to play online.

## Tech

Electron, plain JavaScript, no frontend framework. Main process modules: `auth.js` (sign-in and offline mode), `game.js` (downloading and launching), `hosting.js` (servers and tunnel). The interface lives in `renderer/`.
