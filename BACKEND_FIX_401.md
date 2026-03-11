# Fix 401 for Start trip and Cancel trip (backend)

If the Mini App shows **"Haydovchi tasdiqlanmadi"** or **"Safarni bekor qilish muvaffaqiyatsiz"**, the backend is returning **401** because it does not recognize the driver.

The [taxi-service-on-telegram](https://github.com/shokh2369-arch/taxi-service-on-telegram) backend **already has** the logic to accept the Mini App. You only need to ensure one of the two auth paths works.

---

## How the backend auth works

The backend uses `RequireDriverAuth`, which accepts the driver in two ways:

1. **Telegram initData**  
   If the request has header `X-Telegram-Init-Data` (or query `init_data`), the backend validates it with the driver bot token and resolves the user. **This only works when the Mini App is opened from Telegram**, so that `Telegram.WebApp.initData` is set.

2. **X-Driver-Id header (fallback)**  
   If init data is missing and the config flag is enabled, the backend reads the `X-Driver-Id` header (driver’s internal `user_id`), checks that the user is a driver in the DB, and sets them in context.

The Mini App already sends both:
- **Header:** `X-Telegram-Init-Data` (when opened from Telegram)
- **Header:** `X-Driver-Id` (from the `driver_id` URL parameter)
- **Body:** `trip_id` and `driver_id` for start/finish/cancel

---

## Fix 1: Open the Mini App from Telegram (recommended)

When the driver opens the app **from Telegram** (e.g. by tapping a link sent by the bot), Telegram injects `initData` and the frontend sends it. The backend then validates it and no extra config is needed.

- Ensure the **bot sends the Mini App link with `trip_id` and `driver_id`** (e.g. `https://your-domain/webapp?trip_id=xxx&driver_id=123`).
- If the driver opens the same URL in a normal browser, `initData` will be empty and the backend will return 401 unless Fix 2 is used.

---

## Fix 2: Enable X-Driver-Id fallback (when initData is missing)

If the app is sometimes opened without Telegram (e.g. testing in browser, or initData not available), enable the existing fallback in the backend:

1. In the **backend** environment (e.g. Render, Railway, or `.env`), set:
   ```bash
   ENABLE_DRIVER_ID_HEADER=true
   ```
   (or `ENABLE_DRIVER_ID_HEADER=1`)

2. The backend config already reads this in `internal/config/config.go` and passes it to `RequireDriverAuth`. **No code changes are required** in the backend.

3. Ensure the Mini App URL includes **`driver_id`** when the bot opens it (e.g. `?trip_id=xxx&driver_id=123`). The frontend sends this value as the `X-Driver-Id` header.

**Security:** Only enable this if you trust the Mini App URL (e.g. your own HTTPS Mini App). The backend still checks that the given ID exists and is a driver via `ResolveDriverByUserID`.

---

## Summary

| Problem | Cause | Fix |
|--------|--------|-----|
| "Haydovchi tasdiqlanmadi" / Start trip fails | 401: no initData or X-Driver-Id not allowed | Open app from Telegram, **or** set `ENABLE_DRIVER_ID_HEADER=true` in backend |
| "Safarni bekor qilish muvaffaqiyatsiz" / Cancel fails | Same 401 | Same as above |

After one of these is in place, Start trip and Cancel trip (and Finish / driver location) will work without any frontend changes.
