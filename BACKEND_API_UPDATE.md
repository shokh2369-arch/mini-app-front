# Backend API update: show client phone in Mini App

The Mini App reads **client (rider) phone and name** from the trip API. The [taxi-service-on-telegram](https://github.com/shokh2369-arch/taxi-service-on-telegram) backend currently does not return rider info in `GET /trip/:id`.

Apply the following changes in the **backend repo** so the Mini App can show the client's phone and the call button.

---

## 1. Extend `TripInfoResponse` in `internal/handlers/trip.go`

Add rider fields to the struct (next to `DriverInfo`):

```go
// TripInfoResponse is returned by GET /trip/:id for Mini App map.
type TripInfoResponse struct {
	TripID   string    `json:"trip_id"`
	DriverID int64     `json:"driver_id"`
	Status   string    `json:"status"`
	Pickup   []float64 `json:"pickup"`
	Drop     []float64 `json:"drop"`
	Driver   []float64 `json:"driver"`
	DriverInfo *struct {
		Phone   string `json:"phone,omitempty"`
		CarType string `json:"car_type,omitempty"`
		Color   string `json:"color,omitempty"`
		Plate   string `json:"plate,omitempty"`
	} `json:"driver_info,omitempty"`
	// Rider (client) info for Mini App — add these two lines:
	RiderName  string `json:"rider_name,omitempty"`
	RiderPhone string `json:"rider_phone,omitempty"`
}
```

---

## 2. Load rider from DB and set in response

In the same file, in `TripInfo` handler, after the existing query that loads `tripID`, `status`, `driverUserID`, `pickupLat`, etc.:

- Query the **rider** for this trip. The schema has `trips.rider_user_id` and `users.phone`, `users.name`.
- After building `resp`, set `resp.RiderName` and `resp.RiderPhone`.

**Option A — one extra query (simplest):**

After the first `QueryRowContext` (that loads status, driver_user_id, pickup/drop), add:

```go
var riderUserID int64
err = db.QueryRowContext(ctx, `SELECT rider_user_id FROM trips WHERE id = ?1`, tripID).Scan(&riderUserID)
if err == nil {
	var riderName, riderPhone sql.NullString
	_ = db.QueryRowContext(ctx, `SELECT name, phone FROM users WHERE id = ?1`, riderUserID).Scan(&riderName, &riderPhone)
	if riderName.Valid && riderName.String != "" {
		resp.RiderName = riderName.String
	}
	if riderPhone.Valid && riderPhone.String != "" {
		resp.RiderPhone = riderPhone.String
	}
}
```

**Option B — single query with JOIN:**

Change the first query to also select rider name and phone in one go, for example:

```sql
SELECT t.status, t.driver_user_id, t.rider_user_id,
       r.pickup_lat, r.pickup_lng, r.drop_lat, r.drop_lng
FROM trips t
JOIN ride_requests r ON r.id = t.request_id
WHERE t.id = ?1
```

Then run a second query to get rider name/phone by `rider_user_id` from `users`, or add a JOIN to `users` and select `u.name`, `u.phone` for the rider. Then set `resp.RiderName` and `resp.RiderPhone`.

---

## 3. Frontend (this repo)

The Mini App already supports:

- `rider_phone` and `rider_name` (used when you add them to the backend)
- `rider_info.phone` / `rider_info.name` (if you prefer a nested object)
- `client_phone`, `client_name`, `phone`, `customer_phone` (fallbacks)

No frontend change is needed once the backend returns `rider_phone` and `rider_name`.

---

## Summary

| Backend (taxi-service-on-telegram) | This Mini App |
|-------------------------------------|----------------|
| Add `RiderName`, `RiderPhone` to `TripInfoResponse` | Already reads `rider_name`, `rider_phone` |
| In `TripInfo`, load rider from `trips.rider_user_id` → `users.name`, `users.phone` and set on `resp` | Shows them in the client card and enables the call button |

After deploying the backend change, the client card will show the rider’s name and phone and the “Qo'ng'iroq” button will work.
