# Browser Chat Provider Electron App

This package now runs as a native Electron app. Phase 1 connects directly to Browser Chat Provider from the Electron main process and no longer loads the Chromium extension runtime.

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

Use the `Browser Chat` > `Show Bridge Popup` menu item to open the native bridge popup. You can also use:

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

- Phase 1 uses `electron/native-bridge.cjs` instead of `session.loadExtension()`.
- `BROWSER_CHAT_WS_URL` is written into `electron/runtime-config.json` before the native bridge connects.
- The `Browser Chat` menu opens the native popup for status, agent registration, and debugging.
- Build output is still generated into `dist/content-script.js` and `dist/network-interceptor.js`.
- Phase 1 supports native bridge connection and agent registration. Phase 2 will route `chat.send` into the ChatGPT window via preload/IPC.
