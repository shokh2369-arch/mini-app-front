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
| **Tech** | Vanilla JS, plain CSS, Leaflet, OSRM; no frameworks |

---

## 2. Goals (what we set out to do)

1. **Trip map** — Show driver and client on a map with a road route to the pickup.
2. **In-app navigation** — Let the driver follow their position and the client; show direction and full route.
3. **Distance & ETA** — Show distance and estimated time to the client (instant approximate, then exact via OSRM).
4. **Trip flow** — Start trip and finish trip with clear status messages.
5. **Live fare** — Base fare + per-km price, updating as the driver moves after starting the trip.
6. **Client card** — Show client phone and pickup; one-tap call (Qo'ng'iroq).
7. **Mobile-first** — Large touch targets, sticky panels, safe areas; works in Telegram’s in-app browser.

---

## 3. What we have built

### 3.1 Project structure

```
.
├── README.md                 # Main docs: features, setup, API, troubleshooting
├── BACKEND_API_UPDATE.md     # How to add rider phone/name to the Go backend
├── PLAN_WHAT_WE_HAVE_DONE.md # This file
└── webapp/
    ├── index.html            # Single page: layout, styles, map, client card, route info, fare, buttons
    └── map.js                # Map, trip state, OSRM, fare logic, API, event handlers
```

### 3.2 Frontend (webapp)

#### **index.html**
- **Layout** — Full-screen app shell with safe-area insets.
- **Status banner** — Sticky top bar: “Holat: Mijozga ketilyapti” / “Safar boshlandi” / “Safar tugadi”.
- **Client card** — Mijoz title, phone, pickup (address or coords), “Qo'ng'iroq” button.
- **Map container** — Touch-friendly (`touch-action: none`) for Leaflet pinch/pan.
- **Route info** — Distance to client and ETA; loading state “Yo'nalish hisoblanmoqda...”.
- **Bottom panel** — Sticky: fare (Narx), distance (Masofa), and action buttons.
- **Action buttons** — “Mijozga yo'l”, “SAFARNI BOSHLASH”, “SAFARNI TUGATISH” (shown/hidden by trip status).
- **Missing params overlay** — Shown when `trip_id` or `driver_id` is missing; explains required URL params.
- **Styles** — CSS variables, large tap targets, CARTO-style look; zoom controls sized for touch.
- **Scripts** — Telegram Web App SDK, Leaflet 1.9.4 CSS/JS, `map.js`.

#### **map.js**
- **Params** — `trip_id` from URL or Telegram `startParam` (e.g. `trip_123`); `driver_id` from URL.
- **API** — `API_BASE` config; `GET /trip/:id`, `POST /driver/location`, `POST /trip/start`, `POST /trip/finish`.
- **Map** — Leaflet init, CARTO Light tiles, zoom control; default view Tashkent area.
- **Markers** — Pickup (client icon SVG), driver (car emoji); popups.
- **Routing** — OSRM public API for driving route (GeoJSON); draw polyline; fit bounds.
- **Quick direction** — Dashed straight line driver→client when “Mijozga yo'l” is first used; then full OSRM route.
- **Distance/ETA** — Instant: Haversine + ~25 km/h ETA; then OSRM distance and duration when route is loaded.
- **Trip states** — WAITING / STARTED / FINISHED; button visibility and status text per state.
- **Fare** — `BASE_FARE` (4,000 so'm) + `PER_KM_FARE` (1,500 so'm/km); distance from geolocation after “SAFARNI BOSHLASH” via Haversine; live update in bottom panel.
- **Client data** — Parse `rider_phone`, `rider_name`, `rider_info`, `pickup_address`, etc.; normalize phone for display and `tel:` link.
- **Call** — “Qo'ng'iroq”: try `Telegram.WebApp.openLink(tel:...)`, then fallbacks (`window.open`, `<a>` click).
- **Geolocation** — `watchPosition` + `getCurrentPosition`; send position to backend; update driver marker; in “Mijozga yo'l” mode, map follows driver and client.
- **Refresh** — Poll `GET /trip/:id` every 3 s to keep status and driver position in sync.
- **Event handlers** — Mijozga yo'l (toggle follow), Start trip, Finish trip; call button click.

### 3.3 Backend contract (assumed)

| Method | Endpoint | Body | Purpose |
|--------|----------|------|---------|
| GET | `/trip/:id` | — | Trip: `status`, `pickup`, `driver`, optional `rider_phone`, `rider_name`, `pickup_address` |
| POST | `/driver/location` | `{ driver_id, lat, lng }` | Update driver position |
| POST | `/trip/start` | `{ trip_id, driver_id }` | Start trip |
| POST | `/trip/finish` | `{ trip_id, driver_id }` | Finish trip |

Trip status values: `WAITING`, `STARTED`, `FINISHED`.

### 3.4 Backend integration guide (BACKEND_API_UPDATE.md)

- **Goal** — Have the Mini App show client phone and make “Qo'ng'iroq” work.
- **Content** — How to extend the Go backend (e.g. taxi-service-on-telegram): add `RiderName` and `RiderPhone` to `TripInfoResponse`; load rider from DB (`trips.rider_user_id` → `users.name`, `users.phone`); Option A (extra query) and Option B (JOIN) snippets.
- **Frontend** — No change needed once backend returns `rider_phone` / `rider_name` (and fallbacks documented).

### 3.5 Configuration (map.js)

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `'https://taxi-service-on-telegram.onrender.com'` | Backend base URL (no trailing slash) |
| `BASE_FARE` | `4000` | Base fare (so'm) |
| `PER_KM_FARE` | `1500` | Per-km fare (so'm) |

---

## 4. Driver flow (implemented)

1. Driver opens Mini App with `trip_id` and `driver_id` (URL or startParam).
2. If params missing → “Reja va haydovchi bilan oching” overlay.
3. App loads trip; status banner shows state; client card shows phone and pickup; “Qo'ng'iroq” if phone present.
4. Map shows driver and client markers; route to client is requested from OSRM; distance/ETA: first “~X km / ~Y daqiqa”, then exact.
5. “Mijozga yo'l” — Follow mode: dashed line then full route; map follows driver and client; distance/ETA update.
6. “SAFARNI BOSHLASH” — Start trip; fare panel shows base + per-km; distance and fare update as driver moves.
7. “SAFARNI TUGATISH” — Finish trip; fare and distance stay visible; location polling can stop.

---

## 5. Technical choices

- **No build step** — Plain HTML/CSS/JS; easy to host on any static host (e.g. Vercel, Netlify).
- **Leaflet + CARTO** — Lightweight map; readable tiles.
- **OSRM (public)** — Free driving routes; can be swapped for another provider later.
- **Haversine** — For instant distance and for trip distance (after start) when no route segment API is used.
- **Uzbek (Latin)** — All user-facing strings in one language for the driver app.

---

## 6. Documentation delivered

| File | Purpose |
|------|---------|
| **README.md** | Features, project structure, requirements, setup (backend URL, hosting, Telegram bot, rider phone), usage flow, API contract, config, tech stack, backend integration, troubleshooting. |
| **BACKEND_API_UPDATE.md** | Step-by-step backend changes for rider phone/name and call button. |
| **PLAN_WHAT_WE_HAVE_DONE.md** | This plan: what was done, structure, and flow. |

---

## 7. Summary checklist

- [x] Trip map with driver and client markers
- [x] Road route (OSRM) from driver to pickup
- [x] In-app navigation (“Mijozga yo'l”) with follow mode and route
- [x] Instant then exact distance and ETA to client
- [x] Start/Finish trip with status messages
- [x] Live fare (base + per-km) and trip distance
- [x] Client card with phone and pickup
- [x] Qo'ng'iroq (call) with Telegram/openLink and fallbacks
- [x] Mobile-first UI and safe areas
- [x] Params from URL and Telegram startParam
- [x] Backend API contract and backend-update guide
- [x] README and troubleshooting

---

*Last updated: March 2025*
