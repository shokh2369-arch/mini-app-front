# Full plan — What we have done

This document summarizes the **YettiQanot Haydovchi** (Trip Map Mini App) project: scope, deliverables, and implementation details.

---

## 1. Project overview

| Item | Description |
|------|-------------|
| **Name** | YettiQanot Haydovchi — Trip Map Mini App |
| **Type** | Telegram Mini App (single-page web app) |
| **Audience** | Taxi drivers (haydovchilar) |
| **Language** | Uzbek (Latin) for all UI text |
| **Tech** | Vanilla JS, plain CSS, Leaflet, OSRM, Telegram WebApp SDK; no frameworks |

---

## 2. Goals (what we set out to do)

1. **Trip map** — Show driver and client on a map with a road route to the pickup.
2. **In-app navigation** — Let the driver follow their position and the client; show direction and full route; map auto-centers on driver in follow mode.
3. **Distance & ETA** — Show distance and estimated time to the client (instant approximate, then exact via OSRM).
4. **Trip flow** — Start, finish, and **cancel** trip with clear status messages.
5. **Fare** — Display fare (and optional distance) from the backend only; no frontend recalculation.
6. **Client card** — Show client phone and pickup; one-tap call (Qo'ng'iroq).
7. **Real-time updates** — WebSocket for trip and driver location updates instead of polling.
8. **Mobile-first** — Large touch targets, sticky panels, safe areas, vibration on trip start; works in Telegram’s in-app browser.

---

## 3. What we have built

### 3.1 Project structure

```
.
├── README.md                   # Main docs: features, setup, API, troubleshooting
├── BACKEND_API_UPDATE.md       # How to add rider phone/name to the Go backend
├── BACKEND_COMPATIBILITY.md    # taxi-service-on-telegram: API contract, WebSocket, auth options
├── BACKEND_FIX_401.md          # Fix 401 for Start/Cancel: open from Telegram or ENABLE_DRIVER_ID_HEADER
├── PLAN_WHAT_WE_HAVE_DONE.md   # This file
└── webapp/
    ├── index.html              # Single page: layout, styles, map, client card, route info, fare panel, buttons
    └── map.js                  # Map, trip state, OSRM, WebSocket, fare/stats refresh, API, event handlers
```

### 3.2 Frontend (webapp)

#### **index.html**
- **Layout** — Full-screen app shell with safe-area insets.
- **Status banner** — Sticky top: “Holat: Mijozga ketilyapti” / “Safar boshlandi” / “Safar tugadi” / “Safar bekor qilindi”.
- **Client card** — Mijoz title, phone, pickup (address or coords), “Qo'ng'iroq” button.
- **Map container** — Touch-friendly (`touch-action: none`) for Leaflet pinch/pan.
- **Route info** — Distance to client and ETA; loading state “Yo'nalish hisoblanmoqda...”.
- **Bottom panel** — Sticky: fare (Narx), distance (Masofa), and action buttons.
- **Action buttons** — “SAFARNI BOSHLASH”, “SAFARNI TUGATISH”, “Safarni bekor qilish” (cancel); shown/hidden by trip status. (Pickup navigation is automatic in WAITING; no “Mijozga yo'l” button.)
- **Missing params overlay** — Shown when `trip_id` or `driver_id` is missing.
- **UX** — Larger buttons (min-height 62px, 18px font), improved pickup marker (pin-style SVG), route line highlight (drop-shadow), touch-friendly zoom controls.
- **Scripts** — Telegram Web App SDK, Leaflet 1.9.4 CSS/JS, `map.js`.

#### **map.js**
- **Params** — `trip_id` from URL or Telegram `startParam` (e.g. `trip_123`); `driver_id` from URL.
- **API** — `API_BASE`; `GET /trip/:id`, `POST /driver/location`, `POST /trip/start`, `POST /trip/finish`, **`POST /trip/cancel/driver`**.
- **WebSocket** — Connect to `wss://<API_BASE host>/ws?trip_id=xxx&init_data=...` (query params; no post-connect subscribe). Listen for: `driver_location_update` (lat, lng), `trip_started`, `trip_finished`, `trip_cancelled`. On trip/location events call `refreshTrip()` so UI (including stats) stays in sync. Reconnect on close (3s delay).
- **Map** — Leaflet, CARTO Light tiles, zoom control; default view Tashkent area.
- **Markers** — Pickup (improved pin-style client SVG), driver (car emoji); popups.
- **Routing** — OSRM for driving route (GeoJSON); draw polyline with highlight. **Route recalculation** when driver deviates >50 m; throttle 5 s. **Automatic pickup route** in WAITING: route driver→pickup drawn and redrawn on driver move (no manual “Mijozga yo'l”); top row “Mijozgacha” / “Yetib borish” shows distance/ETA to rider.
- **Trip progress path** — In STARTED, green polyline (`tripProgressLine`) grows as driver moves; pickup route cleared.
- **Distance/ETA (top)** — WAITING: “Mijozgacha” and “Yetib borish” from OSRM or Haversine. STARTED/FINISHED: top row set to “—”; only bottom stats are live.
- **Trip states** — WAITING / STARTED / FINISHED / CANCELLED / CANCELLED_BY_DRIVER / CANCELLED_BY_RIDER; button visibility and status text per state.
- **Fare and trip stats (backend only)** — Single source: `renderTripStats(trip)` uses `parseFareFromTrip(data)` and `updateFareDisplay(fare, distance)` for **Narx** and **Masofa**. No frontend fare calculation. **Live during STARTED:** `refreshTrip()` every 3 s (`startLiveTripRefresh`); **after FINISHED:** immediate `refreshTrip()` plus one delayed (1.5 s) to show final values. Stats refresh on initial load, after Start/Finish/Cancel, and on WebSocket trip_started / trip_finished / trip_cancelled.
- **Client data** — Parse `rider_phone`, `rider_name`, `rider_info`, `pickup_address`, etc.; normalize phone for display and `tel:` link.
- **Call** — “Qo'ng'iroq”: `Telegram.WebApp.openLink(tel:...)` or fallbacks.
- **GPS** — **Ignore** updates when `accuracy > 50 m`. **Smooth** position using last 3 points (average). `watchPosition` + `getCurrentPosition`; send position to backend; update driver marker. In WAITING, map auto-fits driver and pickup; route redraws as driver moves.
- **Vibration** — `navigator.vibrate(200)` when trip starts (after “SAFARNI BOSHLASH”).
- **Event handlers** — Start trip, Finish trip, Cancel trip, call button. All trip actions use `refreshTrip()` (fetch + `updateFromTrip`) so stats stay in sync.

### 3.3 Backend contract (assumed)

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| GET | `/trip/:id` | — | Trip: `status`, `pickup`, `driver`, optional `rider_phone`, `rider_name`, `pickup_address`, **`fare`** (or `total_fare`, `amount`, `price`), optional **`distance_km`** / `trip_distance` |
| POST | `/driver/location` | `{ driver_id, lat, lng }` | Update driver position |
| POST | `/trip/start` | `{ trip_id, driver_id }` | Start trip |
| POST | `/trip/finish` | `{ trip_id, driver_id }` | Finish trip |
| POST | `/trip/cancel/driver` | `{ trip_id, driver_id }` | Cancel trip (driver) |
| WebSocket | `/ws?trip_id=xxx&init_data=...` | — | Query params for subscription. Events: `driver_location_update` (lat, lng), `trip_started`, `trip_finished`, `trip_cancelled` |

Trip status values: `WAITING`, `STARTED`, `FINISHED`, `CANCELLED`, `CANCELLED_BY_DRIVER`, `CANCELLED_BY_RIDER`.

### 3.4 Backend integration guide (BACKEND_API_UPDATE.md)

- **Goal** — Show client phone and enable “Qo'ng'iroq”.
- **Content** — Add `RiderName` and `RiderPhone` to trip response; load from DB. Frontend already supports `rider_phone` / `rider_name` and fallbacks.

### 3.5 Configuration (map.js)

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `'https://taxi-service-on-telegram.onrender.com'` | Backend base URL (no trailing slash). WebSocket: `wss://<host>/ws?trip_id=...&init_data=...`. |
| `LIVE_TRIP_POLL_INTERVAL_MS` | `3000` | Interval (ms) for `refreshTrip()` during STARTED so Narx/Masofa update from backend. |

Fare and tariff come from the backend only. Stats refresh: `renderTripStats(trip)`, `refreshTrip()`, `startLiveTripRefresh()` / `stopLiveTripRefresh()`.

---

## 4. Driver flow (implemented)

1. Driver opens Mini App with `trip_id` and `driver_id` (URL or startParam).
2. If params missing → “Reja va haydovchi bilan oching” overlay.
3. App loads trip via `refreshTrip()` (GET `/trip/:id` + `updateFromTrip`); status banner, client card (phone, pickup, Qo'ng'iroq), and **fare panel (Narx, Masofa)** show backend data.
4. **WAITING:** Map shows driver and client markers; **pickup route (driver→client) draws automatically** and redraws as driver moves; “Mijozgacha” / “Yetib borish” show distance/ETA. Route recalculates if driver deviates >50 m.
5. “SAFARNI BOSHLASH” — Start trip; **vibration**; pickup route cleared; **trip progress polyline** starts; **live stats:** every 3 s `refreshTrip()` so Narx/Masofa update from backend; top row set to “—”.
6. “SAFARNI TUGATISH” — Finish trip; `refreshTrip()` then delayed (1.5 s) refresh for final fare/distance; buttons hidden; polling stopped.
7. “Safarni bekor qilish” — Cancel trip (POST `/trip/cancel/driver`); `refreshTrip()`; status “Safar bekor qilindi”; buttons hidden; polling stopped.
8. **WebSocket** delivers driver_location_update, trip_started, trip_finished, trip_cancelled; each triggers `refreshTrip()` so UI and stats stay in sync.

---

## 5. Technical choices

- **No build step** — Plain HTML/CSS/JS; easy to host on any static host (e.g. Vercel, Netlify).
- **Leaflet + CARTO** — Lightweight map; readable tiles.
- **OSRM (public)** — Driving routes; recalc on deviation >50 m (point-to-segment distance).
- **WebSocket** — Real-time trip and location updates; no 3s polling.
- **Fare from backend** — Single source of truth; frontend only displays API response.
- **GPS** — Accuracy filter (≤50 m); 3-point smoothing for stable marker.
- **Uzbek (Latin)** — All user-facing text in one language.

---

## 6. Documentation delivered

| File | Purpose |
|------|---------|
| **README.md** | Features, structure, requirements, setup, API, config, tech stack, troubleshooting (incl. 401 / ENABLE_DRIVER_ID_HEADER). |
| **BACKEND_API_UPDATE.md** | Backend changes for rider phone/name and call button. |
| **BACKEND_COMPATIBILITY.md** | taxi-service-on-telegram: API contract, WebSocket URL, when to add driver auth (initData or X-Driver-Id). |
| **BACKEND_FIX_401.md** | Fix 401 for Start/Cancel: open app from Telegram or set ENABLE_DRIVER_ID_HEADER=true in backend. |
| **PLAN_WHAT_WE_HAVE_DONE.md** | This plan: what was done, structure, flow. |

---

## 7. Summary checklist

- [x] Trip map with driver and client markers
- [x] Road route (OSRM) from driver to pickup; **recalc when driver deviates >50 m**
- [x] **Automatic pickup navigation** in WAITING (route draws and redraws; no “Mijozga yo'l” button)
- [x] Distance/ETA to client (Mijozgacha / Yetib borish) in WAITING; “—” in STARTED/FINISHED
- [x] **Trip progress polyline** (green path) during STARTED
- [x] Start / Finish / **Cancel** trip with status messages
- [x] **Fare and distance from backend only**; **live stats** during STARTED (3 s refresh) and **final values** after FINISHED (immediate + delayed refresh)
- [x] **renderTripStats(trip)**, **refreshTrip()**, **startLiveTripRefresh** / **stopLiveTripRefresh**
- [x] Client card with phone and pickup; Qo'ng'iroq
- [x] **WebSocket** (`/ws?trip_id=...&init_data=...`) for real-time updates; refreshTrip on trip events
- [x] **GPS**: ignore accuracy >50 m; smooth with last 3 points
- [x] **UX**: larger buttons, better pickup marker, route highlight, **vibration on trip start**
- [x] Mobile-first UI and safe areas
- [x] Params from URL and Telegram startParam
- [x] Backend API contract; BACKEND_COMPATIBILITY.md, BACKEND_FIX_401.md
- [x] README and troubleshooting

---

*Last updated: March 2025*
