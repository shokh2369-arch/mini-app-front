# YettiQanot Haydovchi — Trip Map Mini App

A **Telegram Mini App** for taxi drivers: view the trip map, navigate to the client, start and finish the trip, and see live fare — all in Uzbek (Latin).

---

## Features

- **Trip map** — Driver (car) and client (person) markers; **pickup leg** uses OSRM from driver to pickup (blue polyline, separate from the green **trip progress** line after start).
- **Pickup navigation** — While the backend status is `WAITING`, a dashed helper line and then the full road route draw automatically as the driver moves (no separate “Mijozga yo’l” button).
- **Instant distance & ETA to pickup** — Approximate straight-line values first; road distance and ETA when OSRM responds.
- **Pickup-then-start flow** — **Yetib keldim** (enabled when the driver is within about **100 m** of pickup) must be confirmed before **SAFARNI BOSHLASH** appears. Trip fare and progress do **not** run until the trip is actually started.
- **Status phases** — Banner and copy follow: **Mijozga yo’lda** → **Safarni boshlash mumkin** → **Safar boshlandi** (after start), with Uzbek helper text in the accessibility status line.
- **Trip flow** — **SAFARNI BOSHLASH** / **SAFARNI TUGATISH** / cancel; live **Narx** and **Masofa** from the backend after **STARTED** (poll + WebSocket refresh).
- **Client card** — Mijoz phone and pickup; **Qo'ng'iroq** opens the dialer.
- **Mobile-first UI** — Large buttons, fare panel, sticky status banner; works in Telegram’s in-app browser.

---

## Project structure

```
.
├── README.md              # This file
├── BACKEND_API_UPDATE.md  # How to add rider phone/name to the backend
└── webapp/
    ├── index.html         # Single page: layout, styles, map container, client card, route info, fare panel, buttons
    └── map.js             # Map init, trip state, OSRM routing, fare logic, API calls, event handlers
```

- **index.html** — Layout and CSS for status banner, client card, map, route info (distance/ETA to pickup), fare panel, and actions: **Yetib keldim**, **SAFARNI BOSHLASH**, **SAFARNI TUGATISH**, cancel. Loads Leaflet and `map.js`.
- **map.js** — Resolves `trip_id` / `driver_id`; fetches trip; Leaflet + OSRM for the **pickup** route while `WAITING`; frontend phases **TO_PICKUP** → **ARRIVED** (after **Yetib keldim**) before showing start; trip progress polyline and backend-driven fare only when `STARTED`. WebSocket + periodic refresh for live stats.

---

## Requirements

- **Backend API** (e.g. [taxi-service-on-telegram](https://github.com/shokh2369-arch/taxi-service-on-telegram)) that provides:
  - `GET /trip/:id` — Trip with `status`, pickup coords, driver coords, and optionally rider phone/name (see [Backend integration](#backend-integration)).
  - `POST /driver/location` — Body: `{ "driver_id": number, "lat": number, "lng": number }`.
  - `POST /trip/start` — Body: `{ "trip_id": string, "driver_id": number }`.
  - `POST /trip/finish` — Body: `{ "trip_id": string, "driver_id": number }`.
- **HTTPS** — Mini App and geolocation require a secure origin.
- **Telegram Bot** — Mini App URL set in BotFather pointing to your deployed app URL (e.g. `https://your-app.vercel.app/`).
- **Opening the app** — With `trip_id` and `driver_id`, e.g. `?trip_id=123&driver_id=456` or via `startParam` (e.g. `trip_123`; `driver_id` then from URL or bot flow).

---

## Setup

### 1. Backend URL

In `webapp/map.js`, set your API base (no trailing slash):

```js
var API_BASE = 'https://your-backend.example.com';
```

### 2. Host the webapp

Serve the `webapp/` folder over **HTTPS** (required for Telegram Mini Apps and `navigator.geolocation`). For example:

- **Vercel** — Deploy the repo and set the root to `webapp` or deploy from a subfolder.
- **Netlify** — Same idea; publish the directory that contains `index.html`.
- **Any static host** — Ensure `index.html` is served at the Mini App URL and that `map.js` is in the same path (e.g. `/map.js`).

### 3. Telegram bot

1. In [BotFather](https://t.me/BotFather), create or select your bot.
2. **Bot Settings → Menu Button** or **Configure Mini App**: set the Mini App URL to your deployed app (e.g. `https://your-app.vercel.app/`).
3. Ensure drivers open the app with the correct params (e.g. your backend sends a link like `https://t.me/YourBot/app?startapp=trip_123` and the bot or web app adds `&driver_id=456` if needed).

### 4. Backend: rider phone for "Qo'ng'iroq"

For the client card and **Qo'ng'iroq** (call) button to work, `GET /trip/:id` must return the rider's phone (and optionally name). See [BACKEND_API_UPDATE.md](BACKEND_API_UPDATE.md) for step-by-step changes to the Go backend (e.g. add `rider_phone` / `rider_name` to the response and load them from the DB).

---

## Usage (driver flow)

1. **Open the Mini App** — From the bot link with `trip_id` and `driver_id`. The status banner shows **Holat: Mijozga yo’lda** while you are driving to pickup (backend `WAITING`).
2. **Client card** — Mijoz, phone, pickup. Use **Qo'ng'iroq** to call.
3. **To pickup** — Map shows driver and client markers and the **pickup route** (blue). Under the map: distance and ETA **to the pickup point** (~approx first, then OSRM). **Narx / Masofa** stay **—** until the trip is started; no metered trip progress during this leg.
4. **Yetib keldim** — When you are within about **100 m** of the pickup, this button enables. Tap it to confirm arrival. The banner switches to **Safarni boshlash mumkin** and **SAFARNI BOSHLASH** appears.
5. **SAFARNI BOSHLASH** — Sends `POST /trip/start`. Pickup route clears; **trip** progress (green) and live **Narx / Masofa** from the backend begin.
6. **SAFARNI TUGATISH** — Ends the trip; final fare overlay and stats from the backend.

---

## API contract (frontend ↔ backend)

| Method | Endpoint | Request body | Notes |
|--------|----------|--------------|--------|
| GET | `/trip/:id` | — | Returns trip: `status`, `pickup` (or `pickup_lat`/`pickup_lng`), `driver` (or `driver_lat`/`driver_lng`), optional `rider_phone`, `rider_name`, `pickup_address`. |
| POST | `/driver/location` | `{ "driver_id", "lat", "lng" }` | Called on geolocation updates. |
| POST | `/trip/start` | `{ "trip_id", "driver_id" }` | Start trip. |
| POST | `/trip/finish` | `{ "trip_id", "driver_id" }` | Finish trip. |

Trip `status` values used by the app: `WAITING`, `STARTED`, `FINISHED`.

---

## Configuration (in `webapp/map.js`)

| Variable | Typical / example | Description |
|----------|-------------------|-------------|
| `API_BASE` | Your deploy URL | Backend base URL (no trailing slash). WebSocket: `wss://<host>/ws?trip_id=...`. |
| `PICKUP_ARRIVAL_RADIUS_KM` | `0.1` (~100 m) | Driver must be within this radius of pickup for **Yetib keldim** to enable. Use `0.05` for ~50 m. |
| `LIVE_TRIP_POLL_INTERVAL_MS` | `3000` | How often to refetch the trip while `STARTED` for live fare/distance. |
| `PICKUP_ROUTE_REDRAW_INTERVAL_MS` | `5000` | Throttle for OSRM redraw of the pickup route while moving. |

Fare and trip distance are **not** calculated in the browser for billing: they come from **`GET /trip/:id`** after the trip is **STARTED**.

---

## Tech stack

- **Map** — [Leaflet](https://leafletjs.com/) 1.9.4, tiles: CARTO Light (OpenStreetMap).
- **Routing** — [OSRM](https://project-osrm.org/) (public demo) for road geometry, distance, and duration.
- **Language** — Uzbek (Latin) for all user-facing text.
- **No frameworks** — Vanilla JS and plain CSS.

---

## Backend integration

This frontend is designed to work with the Go backend [taxi-service-on-telegram](https://github.com/shokh2369-arch/taxi-service-on-telegram). To show the client's phone and enable the call button:

1. Add `rider_phone` (and optionally `rider_name`) to the `GET /trip/:id` response.
2. Load rider data from your DB (e.g. via `trips.rider_user_id` → `users.phone` / `users.name`).

Detailed steps and code snippets are in **[BACKEND_API_UPDATE.md](BACKEND_API_UPDATE.md)**.

---

## Troubleshooting

- **"404: NOT_FOUND" / Code: NOT_FOUND** — You are opening the **wrong URL**. That screen is the backend’s JSON error page. Open the **Mini App** URL so the HTML loads first, e.g. **Rider:** `https://your-domain.com/webapp/rider-map.html?trip_id=123` or **Driver:** `https://your-domain.com/webapp/index.html?trip_id=123&driver_id=456`. The backend API base (e.g. `https://api.example.com`) is for API calls only; the webapp (rider-map.html, index.html) must be served by your frontend host or by the backend’s static route (e.g. `/webapp/`). If the trip truly doesn’t exist, the in-app message will be “Reja topilmadi”.
- **"Reja va haydovchi bilan oching" / missing params** — The app needs `trip_id` and `driver_id` in the URL (or `startParam` for `trip_id`). Ensure the bot sends the correct Mini App link with these params.
- **"Safarni boshlash" / "Safarni bekor qilish" returns 401 or "Haydovchi tasdiqlanmadi"** — The backend needs to recognize the driver. **Option 1:** Open the Mini App from Telegram (tap the link the bot sends) so `initData` is sent and validated. **Option 2:** In the backend env set `ENABLE_DRIVER_ID_HEADER=true` so the backend accepts the `X-Driver-Id` header when initData is missing. See [BACKEND_FIX_401.md](BACKEND_FIX_401.md).
- **Map or route not loading** — Check that the page is served over HTTPS and that the backend is reachable; check the browser console for failed requests.
- **Qo'ng'iroq does nothing** — Ensure the backend returns `rider_phone` (or `rider_info.phone`, etc.) and that the device allows the app to open `tel:` links (some in-app browsers may restrict this).
- **Fare or distance wrong** — Fare and distance come from the backend (`GET /trip/:id`). Check the backend response and config (e.g. `PRICE_PER_KM`, `StartingFee`).

---

## License

Use and modify as needed for your project.
