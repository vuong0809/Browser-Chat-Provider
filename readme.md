# 9Router Browser Chat

## Tổng quan

Dự án này cung cấp một lớp bridge/router để kết nối các agent hoặc ứng dụng bên ngoài với các phiên ChatGPT đang chạy trong trình duyệt.

Kiến trúc hiện tại gồm hai thành phần chính:

- `browser-chat`: thư viện/server TypeScript ở phía local, quản lý bridge, agent, request queue và giao tiếp WebSocket.
- `browser-chat-bridge`: browser extension, chạy trong trình duyệt và làm cầu nối tới ChatGPT Web.

Luồng tổng quát:

```text
Agent / Client
      |
      | WebSocket
      v
browser-chat
      |
      | Bridge protocol
      v
browser-chat-bridge
      |
      +--> ChatGPT Web page
      |
      +--> ChatGPT provider adapter
```

## Cấu trúc dự án

```text
9router/
├── browser-chat/
│   ├── agent-registry.ts
│   ├── bridge-manager.ts
│   ├── index.ts
│   ├── request-manager.ts
│   ├── request-queue.ts
│   ├── websocket-server.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── ...
│
├── browser-chat-bridge/
│   ├── src/
│   │   ├── background/
│   │   │   ├── agent-registry.js
│   │   │   ├── heartbeat.js
│   │   │   ├── request-router.js
│   │   │   ├── service-worker.js
│   │   │   └── websocket.js
│   │   ├── content/
│   │   │   ├── content-script.js
│   │   │   ├── message-handler.js
│   │   │   ├── network-response-bridge.js
│   │   │   └── observer.js
│   │   ├── popup/
│   │   ├── protocol/
│   │   ├── providers/
│   │   │   ├── base/
│   │   │   └── chatgpt/
│   │   └── shared/
│   ├── dist/
│   ├── package.json
│   └── ...
│
├── browser-tool-test.json
├── browser-tool-result-test.json
└── test.txt
```

## `browser-chat`

Đây là phần core chạy bằng Node.js/TypeScript.

### Thành phần chính

- `AgentRegistry`: đăng ký và quản lý các agent.
- `BridgeManager`: quản lý kết nối browser bridge.
- `RequestManager`: quản lý vòng đời request/chat.
- `RequestQueue`: xếp hàng request khi cần xử lý tuần tự hoặc khi bridge chưa sẵn sàng.
- `BrowserChatWebSocketServer`: cung cấp giao tiếp WebSocket.
- `BrowserChatModule`: module chính để tích hợp Browser Chat vào ứng dụng host.

`BrowserChatModule` hỗ trợ hai chế độ WebSocket:

- `standalone`: Browser Chat tự sở hữu TCP/WebSocket listener.
- `attached`: ứng dụng host sở hữu HTTP server và chuyển HTTP upgrade request cho Browser Chat thông qua `handleUpgrade()`.

Theo source hiện tại, chế độ `attached` được thiết kế để tích hợp với 9Router.

### Tools

Module hiện cung cấp ba tool:

- `browser-chat-list`
- `browser-chat-ask`
- `browser-chat-cancel`

Các tool tương ứng với việc liệt kê agent/bridge, gửi yêu cầu chat và hủy request.

### Dependencies

Các dependency chính:

- Node.js
- TypeScript
- `ws`
- `@types/node`
- `@types/ws`

## `browser-chat-bridge`

Đây là browser extension làm cầu nối giữa WebSocket server và ChatGPT Web.

### Background

`src/background/` chịu trách nhiệm quản lý lifecycle của extension và kết nối tới Browser Chat:

- `service-worker.js`: service worker chính.
- `websocket.js`: kết nối WebSocket.
- `request-router.js`: định tuyến request.
- `agent-registry.js`: quản lý agent.
- `heartbeat.js`: heartbeat/duy trì kết nối.

### Content scripts

`src/content/` giao tiếp với trang ChatGPT và xử lý message/network response:

- `content-script.js`
- `message-handler.js`
- `network-response-bridge.js`
- `observer.js`

### Provider adapter

Provider hiện được định nghĩa là:

```text
chatgpt-web
```

Adapter ChatGPT nằm tại:

```text
src/providers/chatgpt/
```

bao gồm các thành phần xử lý composer, selector, network interception và response observation.

## Protocol

Protocol sử dụng các message type chính:

```text
request
response
event
error
```

### Bridge

```text
bridge.register
bridge.registered
bridge.heartbeat
bridge.status
```

### Agent

```text
agent.register
agent.unregister
agent.status
agent.list
```

### Chat

```text
chat.send
chat.delta
chat.completed
chat.cancel
chat.error
```

### Trạng thái

Bridge có các trạng thái:

```text
disconnected
connecting
connected
registering
ready
error
```

Agent có các trạng thái chính:

```text
offline
idle
sending
generating
completed
canceled
error
```

Request có các trạng thái:

```text
pending
queued
sending
generating
completed
canceled
timeout
error
```

## Capabilities

Provider hiện khai báo các capability:

```text
text
stream
cancel
tab.discovery
```

Trong đó:

- `text`: gửi/nhận nội dung text.
- `stream`: hỗ trợ dữ liệu response dạng streaming/delta.
- `cancel`: hủy request đang chạy.
- `tab.discovery`: phát hiện tab/provider phù hợp.

## Internal extension messages

Extension sử dụng các message nội bộ như:

```text
CHAT_SEND
CHAT_CANCEL
CHAT_STARTED
CHAT_DELTA
CHAT_COMPLETED
CHAT_ERROR
PROVIDER_DETECTED
PROVIDER_STATUS
GET_BRIDGE_STATUS
GET_CURRENT_AGENT
GET_AGENTS
REGISTER_AGENT
UNREGISTER_AGENT
```

## Timing mặc định

Theo protocol constants hiện tại:

| Thiết lập | Giá trị |
|---|---:|
| Heartbeat interval | 15 giây |
| Reconnect initial delay | 1 giây |
| Reconnect maximum delay | 30 giây |
| Chat request timeout | 180 giây |

## Storage

Extension sử dụng các storage key chính:

```text
browserChatBridge.wsUrl
browserChatBridge.bridgeId
browserChatBridge.token
browserChatBridge.agents
```

`BRIDGE_TOKEN` đã được chuẩn bị trong protocol để hỗ trợ authentication trong tương lai. Source hiện tại mô tả authentication là tùy chọn và MVP có thể chưa yêu cầu token.

## Cài đặt

### 1. browser-chat

```powershell
cd browser-chat
npm install
```

Build TypeScript bằng script được định nghĩa trong `package.json` nếu có, hoặc sử dụng TypeScript compiler theo cấu hình `tsconfig.json`.

### 2. browser-chat-bridge

```powershell
cd browser-chat-bridge
npm install
```

Extension đã có thư mục `dist/` chứa các artifact được build.

## Chạy và tích hợp

`browser-chat` có thể được sử dụng như một module trong ứng dụng Node.js host hoặc chạy theo mô hình standalone tùy cấu hình WebSocket.

Khi tích hợp vào 9Router, mô hình được thiết kế là:

```text
9Router HTTP/WebSocket server
          |
          +--> BrowserChatModule (attached)
                           |
                           v
                  Browser Chat Bridge
                           |
                           v
                       ChatGPT Web
```

Trong chế độ `attached`, host application chịu trách nhiệm HTTP upgrade và chuyển connection tới `BrowserChatWebSocketServer.handleUpgrade()`.

## Bảo mật

Một số điểm cần duy trì khi phát triển production:

1. Không expose WebSocket server ra Internet nếu không có authentication phù hợp.
2. Sử dụng bridge token hoặc cơ chế xác thực tương đương trước khi cho phép bridge đăng ký.
3. Giới hạn `maxPayloadBytes` để tránh request quá lớn.
4. Giới hạn kích thước `requestQueue`.
5. Validate toàn bộ message theo protocol trước khi routing.
6. Không tin tưởng `agentId`, `bridgeId` hoặc provider data do browser client gửi lên.
7. Giữ WebSocket endpoint ở localhost nếu chỉ phục vụ local automation.

## Phát triển

Khi thay đổi protocol, cần kiểm tra đồng bộ giữa:

```text
browser-chat/src/protocol/
browser-chat-bridge/src/protocol/
```

Đặc biệt cần giữ nhất quán:

- message types
- method names
- payload schema
- agent/request status
- capability names
- heartbeat/reconnect behavior

## Trạng thái dự án

Dự án hiện có hai lớp chính: core Browser Chat viết bằng TypeScript và browser extension bridge viết bằng JavaScript. ChatGPT Web là provider được hỗ trợ trong protocol hiện tại.

README này mô tả cấu trúc và behavior dựa trên source hiện có trong workspace; các command build/run cụ thể nên được xác nhận lại từ `package.json` tương ứng trước khi đưa vào CI hoặc production.
