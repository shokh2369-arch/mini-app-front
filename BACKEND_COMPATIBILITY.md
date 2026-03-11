# Backend compatibility — taxi-service-on-telegram

This Mini App is designed to work with [taxi-service-on-telegram](https://github.com/shokh2369-arch/taxi-service-on-telegram). **You do not need to change the backend** for basic operation if the backend is already deployed as in the repo.

---

## What the frontend expects (already supported by backend)

| Feature | Backend | Frontend |
|--------|---------|----------|
| **GET /trip/:id** | Returns `status`, `pickup`, `driver`, `distance_km`, `fare`, `rider_phone`, `rider_name` | Uses all of these |
| **POST /trip/start** | Body `{ "trip_id": "..." }`, driver from auth | Sends `trip_id` + `X-Telegram-Init-Data` and `X-Driver-Id` |
| **POST /trip/finish** | Same | Same |
| **POST /trip/cancel/driver** | Same | Same |
| **POST /driver/location** | `{ driver_id, lat, lng }` | Sends that + same headers |
| **WebSocket /ws** | Expects **query**: `?trip_id=xxx` (and optionally `&init_data=...` for auth) | Connects to `wss://host/ws?trip_id=xxx&init_data=...` (no backend change needed) |

The Mini App was updated so that **WebSocket uses the same URL shape as the backend**: `GET /ws?trip_id=xxx`. No backend change is required for WebSocket.

---

## When you might change the backend

### 1. 401 on Start/Finish/Cancel (driver auth)

The backend gets the driver from **auth context** (not from the request body). If the Mini App sends `POST /trip/start` and gets **401 Unauthorized**, the backend is not recognizing the driver.

**Options (choose one in the backend):**

- **Use Telegram initData (recommended)**  
  Add middleware that:
  - Reads the `X-Telegram-Init-Data` header.
  - Validates it with your driver bot token (same as in `internal/ws` / `auth.VerifyMiniAppInitData`).
  - Resolves the Telegram user to your driver `user_id` and sets the user (with role driver) in the request context.  
  Then the existing trip handlers will work without further changes.

- **Use X-Driver-Id for Mini App only**  
  Add middleware that, for requests from your Mini App origin (or when `X-Driver-Id` is present and no cookie/session):
  - Reads `X-Driver-Id`.
  - Loads the driver by that ID and sets them in the request context.  
  Use only if you trust the Mini App URL and consider the security implications.

If you already have such middleware (e.g. for the same initData used by WebSocket auth), **no backend change** is needed.

### 2. WebSocket auth (optional)

The backend has:

- **ServeWs** — no auth; only needs `?trip_id=xxx`.
- **ServeWsWithAuth** — checks `X-Telegram-Init-Data` header or `init_data` query param.

The Mini App now connects to:

`wss://your-api/ws?trip_id=xxx&init_data=...`

So if the backend uses **ServeWs**, it already works. If it uses **ServeWsWithAuth**, the `init_data` in the query is enough; **no backend change** is required for WebSocket.

---

## Summary

| Item | Backend change needed? |
|------|------------------------|
| WebSocket URL (`/ws?trip_id=...`) | **No** — frontend was updated to match. |
| GET /trip/:id (fare, distance_km, etc.) | **No** — already in place. |
| POST /trip/start, finish, cancel/driver | **Only if** you get 401: add or adjust auth middleware (initData or X-Driver-Id). |
| WebSocket events (driver_location_update, trip_started, etc.) | **No** — backend already broadcasts by trip_id. |

So: **you do not need to change the backend** for WebSocket or for the existing API contract. The only optional change is adding (or enabling) **driver auth for HTTP** (initData or X-Driver-Id) if Start/Finish/Cancel return 401.
