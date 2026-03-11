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
├── README.md                 # Main docs: features, setup, API, troubleshooting
├── BACKEND_API_UPDATE.md     # How to add rider phone/name to the Go backend
├── PLAN_WHAT_WE_HAVE_DONE.md # This file
└── webapp/
    ├── index.html            # Single page: layout, styles, map, client card, route info, fare panel, buttons
    └── map.js                # Map, trip state, OSRM, WebSocket, fare display, API, event handlers
```

### 3.2 Frontend (webapp)

#### **index.html**
- **Layout** — Full-screen app shell with safe-area insets.
- **Status banner** — Sticky top: “Holat: Mijozga ketilyapti” / “Safar boshlandi” / “Safar tugadi” / “Safar bekor qilindi”.
- **Client card** — Mijoz title, phone, pickup (address or coords), “Qo'ng'iroq” button.
- **Map container** — Touch-friendly (`touch-action: none`) for Leaflet pinch/pan.
- **Route info** — Distance to client and ETA; loading state “Yo'nalish hisoblanmoqda...”.
- **Bottom panel** — Sticky: fare (Narx), distance (Masofa), and action buttons.
- **Action buttons** — “Mijozga yo'l”, “SAFARNI BOSHLASH”, “SAFARNI TUGATISH”, **“Safarni bekor qilish”** (cancel); shown/hidden by trip status.
- **Missing params overlay** — Shown when `trip_id` or `driver_id` is missing.
- **UX** — Larger buttons (min-height 62px, 18px font), improved pickup marker (pin-style SVG), route line highlight (drop-shadow), touch-friendly zoom controls.
- **Scripts** — Telegram Web App SDK, Leaflet 1.9.4 CSS/JS, `map.js`.

#### **map.js**
- **Params** — `trip_id` from URL or Telegram `startParam` (e.g. `trip_123`); `driver_id` from URL.
- **API** — `API_BASE`; `GET /trip/:id`, `POST /driver/location`, `POST /trip/start`, `POST /trip/finish`, **`POST /trip/cancel/driver`**.
- **WebSocket** — Connect to `wss://<API_BASE host>/ws`; send `{ type: 'subscribe', trip_id, driver_id }`. Listen for: `driver_location_update` (lat, lng), `trip_started`, `trip_finished`, `trip_cancelled`. Update UI immediately; refetch trip on trip_started/trip_finished to get latest fare. Reconnect on close (3s delay).
- **Map** — Leaflet, CARTO Light tiles, zoom control; default view Tashkent area.
- **Markers** — Pickup (improved pin-style client SVG), driver (car emoji); popups.
- **Routing** — OSRM for driving route (GeoJSON); draw polyline with highlight. **Route recalculation** when driver deviates >50 m from route (point-to-segment distance); throttle 5 s.
- **Quick direction** — Dashed line driver→client when “Mijozga yo'l” is first used; then full OSRM route.
- **Distance/ETA** — Instant: Haversine + ~25 km/h ETA; then OSRM distance and duration when route is loaded.
- **Trip states** — WAITING / STARTED / FINISHED / **CANCELLED**; button visibility and status text per state.
- **Fare (backend only)** — No frontend calculation. `parseFareFromTrip(data)` reads `fare`, `total_fare`, `amount`, `price`, `trip_fare` (or nested `fare.amount`/`fare.value`) and `distance_km`, `trip_distance`, `distance`. `updateFareDisplay(fare, distance)` sets fare and distance panel from API response. Called after every trip fetch and in `updateFromTrip(data)`.
- **Client data** — Parse `rider_phone`, `rider_name`, `rider_info`, `pickup_address`, etc.; normalize phone for display and `tel:` link.
- **Call** — “Qo'ng'iroq”: `Telegram.WebApp.openLink(tel:...)` or fallbacks.
- **GPS** — **Ignore** updates when `accuracy > 50 m`. **Smooth** position using last 3 points (average). `watchPosition` + `getCurrentPosition`; send position to backend; update driver marker; in “Mijozga yo'l” mode map follows driver and client.
- **Navigation/follow mode** — “Mijozga yo'l” enables follow mode; map auto-centers on driver and client; “Kuzatishni to'xtatish” exits follow mode.
- **Vibration** — `navigator.vibrate(200)` when trip starts (after “SAFARNI BOSHLASH”).
- **Event handlers** — Mijozga yo'l (toggle follow), Start trip, Finish trip, **Cancel trip**, call button.

### 3.3 Backend contract (assumed)

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| GET | `/trip/:id` | — | Trip: `status`, `pickup`, `driver`, optional `rider_phone`, `rider_name`, `pickup_address`, **`fare`** (or `total_fare`, `amount`, `price`), optional **`distance_km`** / `trip_distance` |
| POST | `/driver/location` | `{ driver_id, lat, lng }` | Update driver position |
| POST | `/trip/start` | `{ trip_id, driver_id }` | Start trip |
| POST | `/trip/finish` | `{ trip_id, driver_id }` | Finish trip |
| POST | `/trip/cancel/driver` | `{ trip_id, driver_id }` | Cancel trip (driver) |
| WebSocket | `/ws` | — | Subscribe with `{ type: 'subscribe', trip_id, driver_id }`. Events: `driver_location_update` (lat, lng), `trip_started`, `trip_finished`, `trip_cancelled` |

Trip status values: `WAITING`, `STARTED`, `FINISHED`, `CANCELLED`.

### 3.4 Backend integration guide (BACKEND_API_UPDATE.md)

- **Goal** — Show client phone and enable “Qo'ng'iroq”.
- **Content** — Add `RiderName` and `RiderPhone` to trip response; load from DB. Frontend already supports `rider_phone` / `rider_name` and fallbacks.

### 3.5 Configuration (map.js)

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `'https://taxi-service-on-telegram.onrender.com'` | Backend base URL (no trailing slash). WebSocket URL derived as `wss://<host>/ws`. |

(Fare and tariff are no longer configured in the frontend; they come from the backend.)

---

## 4. Driver flow (implemented)

1. Driver opens Mini App with `trip_id` and `driver_id` (URL or startParam).
2. If params missing → “Reja va haydovchi bilan oching” overlay.
3. App loads trip via GET `/trip/:id`; status banner and client card (phone, pickup, Qo'ng'iroq) update; **fare panel shows backend fare/distance**.
4. Map shows driver and client markers; OSRM route to client; distance/ETA: “~X km” then exact when route loads. **Route recalculates** if driver deviates >50 m.
5. “Mijozga yo'l” — Follow mode: dashed line then full route; **map auto-centers on driver and client**; distance/ETA update.
6. “SAFARNI BOSHLASH” — Start trip; **vibration**; fare panel shows backend fare (refetched). No frontend fare calculation.
7. “SAFARNI TUGATISH” — Finish trip; refetch trip to show final fare; buttons hidden.
8. “Safarni bekor qilish” — Cancel trip (POST `/trip/cancel/driver`); status “Safar bekor qilindi”; buttons hidden.
9. **WebSocket** delivers driver_location_update, trip_started, trip_finished, trip_cancelled; UI updates without polling.

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
| **README.md** | Features, structure, requirements, setup, API, config, tech stack, troubleshooting. |
| **BACKEND_API_UPDATE.md** | Backend changes for rider phone/name and call button. |
| **PLAN_WHAT_WE_HAVE_DONE.md** | This plan: what was done, structure, flow. |

---

## 7. Summary checklist

- [x] Trip map with driver and client markers
- [x] Road route (OSRM) from driver to pickup; **recalc when driver deviates >50 m**
- [x] In-app navigation (“Mijozga yo'l”) with **follow mode** (map centers on driver)
- [x] Instant then exact distance and ETA to client
- [x] Start / Finish / **Cancel** trip with status messages
- [x] **Fare and distance from backend only** (no frontend calculation)
- [x] Client card with phone and pickup; Qo'ng'iroq
- [x] **WebSocket** for real-time updates (no polling)
- [x] **GPS**: ignore accuracy >50 m; smooth with last 3 points
- [x] **UX**: larger buttons, better pickup marker, route highlight, **vibration on trip start**
- [x] Mobile-first UI and safe areas
- [x] Params from URL and Telegram startParam
- [x] Backend API contract and backend-update guide
- [x] README and troubleshooting

---

*Last updated: March 2025*
