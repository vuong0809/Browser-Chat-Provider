# Browser Chat Provider Electron App

This package now runs as an Electron app that opens ChatGPT and loads the existing Browser Chat Provider bridge as an unpacked Chromium extension.

## Run

Start the local provider first:

```powershell
cd ..\browser-chat
npm run dev
```

Then start the Electron bridge:

```powershell
cd ..\browser-chat-bridge
npm run dev
```

Use the `Browser Chat` > `Show Bridge Popup` menu item to open the bridge popup. You can also use:

```text
Ctrl+Shift+B
```

To override the WebSocket URL used by the Electron bridge:

```powershell
$env:BROWSER_CHAT_WS_URL="ws://127.0.0.1:20130/browser-bridge"
npm run dev
```

Or create `browser-chat-bridge\.env`:

```dotenv
BROWSER_CHAT_WS_URL="ws://127.0.0.1:20130/browser-bridge"
```

You can also pass it directly as an Electron argument:

```powershell
npm run dev -- --ws-url ws://127.0.0.1:20130/browser-bridge
```

Or just pass the WebSocket port:

```powershell
npm run dev -- --ws-port 20130
```

Make sure the provider runs on the same port:

```powershell
cd ..\browser-chat
npm run dev -- --port 20130
```

The bridge connects to the default WebSocket URL:

```text
ws://127.0.0.1:20128/browser-bridge
```

## Notes

- The Electron app reuses the current extension code by loading `manifest.json` with `session.loadExtension()`.
- `BROWSER_CHAT_WS_URL` is written into `electron/runtime-config.json` before the extension starts.
- The `Browser Chat` menu opens the extension popup for status, agent registration, and debugging.
- Build output is still generated into `dist/content-script.js` and `dist/network-interceptor.js`.
- This is the first Electron migration step; later phases can replace Chrome extension APIs with native Electron IPC.
