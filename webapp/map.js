(function () {
  'use strict';

  var map, pickupMarker, driverMarker;
  var pickupRouteLine = null;
  var pickupHelperLine = null;
  var tripProgressLine = null;
  var tripProgressPoints = [];
  var tripId, driverId;
  var tripStatus = '';
  var pickupLat, pickupLng;
  var lastDriverLat, lastDriverLng;
  var lastDriverBearingDeg = 0;
  var locationWatchId = null;
  var tripStartLat, tripStartLng;
  var routeDistanceKm = null;
  var routeEtaMin = null;
  var isRouteLoading = false;
  var clientPhone = null;
  var clientName = null;
  var pickupLabel = null;
  var ws = null;
  var wsReconnectTimer = null;
  var lastPickupRouteDrawTime = 0;
  var lastTripRefetchTime = 0;
  var tripRefreshIntervalId = null;
  var PICKUP_ROUTE_REDRAW_INTERVAL_MS = 5000;
  var TRIP_REFETCH_INTERVAL_MS = 10000;
  var LIVE_TRIP_POLL_INTERVAL_MS = 3000;
  var ROUTE_DEVIATION_METERS = 50;
  var GPS_ACCURACY_MAX_METERS = 50;
  var gpsHistory = [];
  var GPS_HISTORY_SIZE = 3;

  var API_BASE = 'https://taxi-service-on-telegram.onrender.com';

  // Backend (taxi-service-on-telegram) expects GET /ws?trip_id=xxx (and optionally &init_data= for auth).
  function getWsUrl() {
    var base = API_BASE;
    var scheme = 'wss://';
    if (base.indexOf('https://') === 0) {
      base = base.replace('https://', '');
      scheme = 'wss://';
    } else if (base.indexOf('http://') === 0) {
      base = base.replace('http://', '');
      scheme = 'ws://';
    }
    var url = scheme + base + '/ws?trip_id=' + encodeURIComponent(tripId || '');
    try {
      if (typeof Telegram !== 'undefined' && Telegram.WebApp && Telegram.WebApp.initData) {
        url += '&init_data=' + encodeURIComponent(Telegram.WebApp.initData);
      }
    } catch (e) {}
    return url;
  }

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  function getTripId() {
    var id = getQueryParam('trip_id');
    if (id) return id;
    if (typeof Telegram !== 'undefined' && Telegram.WebApp && Telegram.WebApp.startParam) {
      var start = Telegram.WebApp.startParam;
      if (start && start.indexOf('trip_') === 0) return start.replace('trip_', '');
    }
    return null;
  }

  function getDriverId() {
    var id = getQueryParam('driver_id');
    if (id == null || id === '') return null;
    var num = parseInt(id, 10);
    return isNaN(num) ? null : num;
  }

  function setStatus(text) {
    var el = document.getElementById('status');
    if (el) el.textContent = text;
  }

  function showBannerError(message) {
    setText('statusText', message || 'Xatolik');
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setVisible(id, visible) {
    var el = document.getElementById(id);
    if (!el) return;
    if (id === 'routeInfo') el.style.display = visible ? 'flex' : 'none';
    else el.style.display = visible ? 'block' : 'none';
  }

  function normalizePhoneDisplay(phone) {
    if (!phone || typeof phone !== 'string') return '—';
    var p = phone.replace(/\D/g, '');
    if (p.length >= 9 && p.length <= 15) {
      if (p.indexOf('998') === 0) return '+998 ' + p.slice(3).replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4');
      return '+' + p;
    }
    return phone;
  }

  function phoneForTelLink(phone) {
    if (!phone) return null;
    var s = String(phone).replace(/\D/g, '');
    if (s.length < 9) return null;
    if (s.indexOf('998') === 0) return '+' + s;
    if (s.length === 9) return '+998' + s;
    return '+' + s;
  }

  function setStatusBanner() {
    var holat = 'Yuklanmoqda…';
    var dot = '🟢';
    if (tripStatus === 'WAITING') { holat = 'Mijozga ketilyapti'; dot = '🟢'; }
    else if (tripStatus === 'STARTED') { holat = 'Safar boshlandi'; dot = '🟢'; }
    else if (tripStatus === 'FINISHED') { holat = 'Safar tugadi'; dot = '⚪'; }
    else if (tripStatus === 'CANCELLED' || tripStatus === 'CANCELLED_BY_DRIVER') { holat = 'Safar bekor qilindi'; dot = '🔴'; }
    else if (tripStatus === 'CANCELLED_BY_RIDER') { holat = 'Mijoz bekor qildi'; dot = '🔴'; }
    setText('statusText', dot + ' ' + holat);
  }

  function showButton(id, show) {
    var el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
  }

  // Headers for trip/start, trip/finish, trip/cancel: backend expects trip_id in body and driver from auth.
  // Send Telegram WebApp initData for backend auth; optional X-Driver-Id if backend uses it for Mini App.
  function apiHeaders() {
    var h = { 'Content-Type': 'application/json' };
    try {
      if (typeof Telegram !== 'undefined' && Telegram.WebApp && Telegram.WebApp.initData) {
        h['X-Telegram-Init-Data'] = Telegram.WebApp.initData;
      }
    } catch (e) {}
    if (driverId != null) h['X-Driver-Id'] = String(driverId);
    return h;
  }

  function fetchTrip() {
    return fetch(API_BASE + '/trip/' + encodeURIComponent(tripId), { method: 'GET' })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function () { throw new Error(r.status === 404 ? 'Trip not found' : 'Request failed'); });
        }
        return r.json();
      });
  }

  function sendDriverLocation(lat, lng) {
    return fetch(API_BASE + '/driver/location', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ driver_id: driverId, lat: lat, lng: lng })
    });
  }

  // Backend expects trip_id; driver from auth. Sending driver_id in body for backends that accept it for Mini App.
  function startTrip() {
    return fetch(API_BASE + '/trip/start', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ trip_id: String(tripId), driver_id: driverId })
    }).then(function (r) {
      if (!r.ok) {
        var e = new Error(r.status === 401 ? '401 Unauthorized' : 'Start failed');
        e.status = r.status;
        e.response = r;
        throw e;
      }
      return r.text().then(function (text) {
        try { return text && text.length ? JSON.parse(text) : {}; } catch (e) { return {}; }
      });
    });
  }

  function finishTrip() {
    return fetch(API_BASE + '/trip/finish', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ trip_id: String(tripId), driver_id: driverId })
    }).then(function (r) {
      if (!r.ok) throw new Error('Finish failed');
      return r.text().then(function (text) {
        try { return text && text.length ? JSON.parse(text) : {}; } catch (e) { return {}; }
      });
    });
  }

  function cancelTrip() {
    return fetch(API_BASE + '/trip/cancel/driver', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ trip_id: String(tripId), driver_id: driverId })
    }).then(function (r) {
      if (!r.ok) {
        var e = new Error(r.status === 401 ? '401 Unauthorized' : 'Cancel failed');
        e.status = r.status;
        throw e;
      }
      return r.text().then(function (text) {
        try { return text && text.length ? JSON.parse(text) : {}; } catch (e) { return {}; }
      });
    });
  }

  function connectWebSocket() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    var url = getWsUrl();
    try {
      ws = new WebSocket(url);
      ws.onopen = function () { /* Backend subscribed via query trip_id= */ };
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          var type = msg.type || msg.event;
          var payload = msg.payload || msg;
          if (type === 'driver_location_update' && msg.lat != null && msg.lng != null) {
            var newLat = parseFloat(msg.lat);
            var newLng = parseFloat(msg.lng);
            var bearing = lastDriverBearingDeg || 0;
            if (lastDriverLat != null && lastDriverLng != null) {
              var movedKm = haversineKm(lastDriverLat, lastDriverLng, newLat, newLng);
              if (movedKm >= 0.005) { // >= 5 meters
                bearing = calculateBearing(lastDriverLat, lastDriverLng, newLat, newLng);
              }
            }
            lastDriverBearingDeg = bearing;
            addDriverMarker(newLat, newLng, bearing);
            lastDriverLat = newLat;
            lastDriverLng = newLng;
            if (tripStatus === 'WAITING') {
              drawRemainingPickupRoute();
              fitMapToDriverAndClient();
            } else if (tripStatus === 'STARTED') {
              appendTripProgressPoint(lastDriverLat, lastDriverLng);
              maybeRefetchTripForFare();
              fitMapToDriver();
            }
          } else if (type === 'trip_started') {
            refreshTrip().catch(function () { updateFromTrip({ status: 'STARTED' }); });
          } else if (type === 'trip_finished') {
            tripStatus = 'FINISHED';
            refreshTrip().catch(function () { updateFromTrip({ status: 'FINISHED' }); });
          } else if (type === 'trip_cancelled') {
            var status = (payload.trip_status || payload.status || 'CANCELLED');
            if (status === 'CANCELLED_BY_RIDER' || status === 'CANCELLED_BY_DRIVER') {
              tripStatus = status;
            } else {
              tripStatus = 'CANCELLED';
            }
            refreshTrip().catch(function () {
              updateFromTrip({ status: tripStatus });
            });
          }
        } catch (e) {}
      };
      ws.onclose = function () {
        ws = null;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(connectWebSocket, 3000);
      };
      ws.onerror = function () {}
    } catch (e) {}
  }

  function disconnectWebSocket() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }
  }

  function fetchRoute(fromLat, fromLng, toLat, toLng) {
    var coords = fromLng + ',' + fromLat + ';' + toLng + ',' + toLat;
    var url = 'https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson';
    return fetch(url).then(function (r) { return r.json(); });
  }

  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      tap: true
    }).setView([41.3, 69.2], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    if (typeof map.invalidateSize === 'function') map.invalidateSize();
    setTimeout(function () {
      if (map && typeof map.invalidateSize === 'function') map.invalidateSize();
    }, 100);
    setTimeout(function () {
      if (map && typeof map.invalidateSize === 'function') map.invalidateSize();
    }, 400);
  }

  var RIDER_ICON_URL = 'images/rider-pin-transparent.png';

  function addPickupMarker(lat, lng) {
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'pickup-marker client-marker',
        html: '<img src=\"' + RIDER_ICON_URL + '\" alt=\"Mijoz\" class=\"rider-pin-icon\"/>',
        iconSize: [70, 70],
        iconAnchor: [35, 35]
      })
    }).addTo(map).bindPopup('Mijoz / Olib ketish joyi');
  }

  var DRIVER_CAR_ICON_URL = 'images/driver-car-transparent.png';

  /** Bearing in degrees from (lat1,lng1) to (lat2,lng2). 0 = north, 90 = east. */
  function calculateBearing(lat1, lng1, lat2, lng2) {
    var dLon = (lng2 - lng1) * Math.PI / 180;
    var lat1Rad = lat1 * Math.PI / 180;
    var lat2Rad = lat2 * Math.PI / 180;
    var y = Math.sin(dLon) * Math.cos(lat2Rad);
    var x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    var brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  function addDriverMarker(lat, lng, bearingDeg) {
    if (driverMarker) map.removeLayer(driverMarker);
    var deg = (bearingDeg != null && !isNaN(bearingDeg)) ? bearingDeg : 0;
    driverMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'driver-marker',
        html: '<span class="driver-car-icon-wrap" style="display:inline-block;width:76px;height:76px;transform:rotate(' + deg + 'deg)"><img src="' + DRIVER_CAR_ICON_URL + '" alt="Haydovchi" class="driver-car-icon"/></span>',
        iconSize: [76, 76],
        iconAnchor: [38, 38]
      })
    }).addTo(map).bindPopup('Haydovchi');
  }

  function clearPickupRoute() {
    if (pickupHelperLine && map) {
      map.removeLayer(pickupHelperLine);
      pickupHelperLine = null;
    }
    if (pickupRouteLine && map) {
      map.removeLayer(pickupRouteLine);
      pickupRouteLine = null;
    }
  }

  function removePickupMarker() {
    if (pickupMarker && map) {
      map.removeLayer(pickupMarker);
      pickupMarker = null;
    }
  }

  function fitMapToDriver() {
    if (!map || tripStatus !== 'STARTED' || lastDriverLat == null || lastDriverLng == null) return;
    map.setView([lastDriverLat, lastDriverLng], map.getZoom(), { animate: true, duration: 0.5 });
  }

  function drawPickupHelperLine() {
    if (!map || !pickupLat || !pickupLng || lastDriverLat == null || lastDriverLng == null) return;
    if (pickupHelperLine) map.removeLayer(pickupHelperLine);
    pickupHelperLine = L.polyline([[lastDriverLat, lastDriverLng], [pickupLat, pickupLng]], {
      color: '#2563eb',
      weight: 7,
      opacity: 0.9,
      dashArray: '8,8',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
  }

  function clearTripProgressLine() {
    if (tripProgressLine && map) {
      map.removeLayer(tripProgressLine);
      tripProgressLine = null;
    }
    tripProgressPoints = [];
  }

  function appendTripProgressPoint(lat, lng) {
    if (!map || tripStatus !== 'STARTED') return;
    tripProgressPoints.push([lat, lng]);
    if (tripProgressLine && map) map.removeLayer(tripProgressLine);
    if (tripProgressPoints.length < 2) return;
    tripProgressLine = L.polyline(tripProgressPoints, {
      color: '#16a34a',
      weight: 7,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
  }

  function getLatLng(ll) {
    if (!ll) return null;
    if (typeof ll.lat === 'number' && typeof ll.lng === 'number') return [ll.lat, ll.lng];
    if (typeof ll.lat === 'function' && typeof ll.lng === 'function') return [ll.lat(), ll.lng()];
    if (Array.isArray(ll) && ll.length >= 2) return [parseFloat(ll[0]), parseFloat(ll[1])];
    return null;
  }

  function distanceFromPointToRouteKm(lat, lng) {
    if (!pickupRouteLine) return Infinity;
    var latlngs = pickupRouteLine.getLatLngs();
    if (!latlngs || latlngs.length < 2) return Infinity;
    var minDist = Infinity;
    for (var i = 0; i < latlngs.length - 1; i++) {
      var a = getLatLng(latlngs[i]);
      var b = getLatLng(latlngs[i + 1]);
      if (!a || !b) continue;
      var toSeg = pointToSegmentDistanceKm(lat, lng, a[0], a[1], b[0], b[1]);
      if (toSeg < minDist) minDist = toSeg;
    }
    return minDist;
  }

  function pointToSegmentDistanceKm(lat, lng, lat1, lng1, lat2, lng2) {
    var R = 6371;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var segLen = R * c;
    if (segLen < 1e-6) return haversineKm(lat, lng, lat1, lng1);
    var d1 = haversineKm(lat, lng, lat1, lng1);
    var d2 = haversineKm(lat, lng, lat2, lng2);
    var d3 = haversineKm(lat1, lng1, lat2, lng2);
    var u = (d1 * d1 - d2 * d2 + d3 * d3) / (2 * d3);
    u = Math.max(0, Math.min(1, u / d3));
    var latM = lat1 + u * (lat2 - lat1);
    var lngM = lng1 + u * (lng2 - lng1);
    return haversineKm(lat, lng, latM, lngM);
  }

  function drawRemainingPickupRoute() {
    if (tripStatus !== 'WAITING' || !pickupLat || !pickupLng || lastDriverLat == null || lastDriverLng == null || !map) return;
    var now = Date.now();
    if (now - lastPickupRouteDrawTime < PICKUP_ROUTE_REDRAW_INTERVAL_MS) return;
    lastPickupRouteDrawTime = now;
    setRouteLoading(true);
    clearPickupRoute();
    fetchRoute(lastDriverLat, lastDriverLng, pickupLat, pickupLng).then(function (json) {
      if (json.routes && json.routes[0]) {
        var route = json.routes[0];
        if (route.geometry && route.geometry.coordinates && route.geometry.coordinates.length >= 2) {
          var latLngs = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
          if (pickupHelperLine && map) {
            map.removeLayer(pickupHelperLine);
            pickupHelperLine = null;
          }
          pickupRouteLine = L.polyline(latLngs, {
            color: '#2563eb',
            weight: 7,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round',
            className: 'route-line-highlight'
          }).addTo(map);
          routeDistanceKm = route.distance / 1000.0;
          routeEtaMin = route.duration / 60.0;
          setText('routeDistance', formatKm(routeDistanceKm));
          setText('routeEta', formatEtaMin(routeEtaMin));
          fitMapToDriverAndClient();
        }
      }
      setRouteLoading(false);
    }).catch(function () { setRouteLoading(false); });
  }

  function checkRouteDeviationAndRecalc(lat, lng) {
    if (tripStatus !== 'WAITING' || !pickupRouteLine || !pickupLat || !pickupLng) return;
    var distKm = distanceFromPointToRouteKm(lat, lng);
    if (distKm * 1000 <= ROUTE_DEVIATION_METERS) return;
    drawRemainingPickupRoute();
  }

  function setRouteLoading(loading) {
    isRouteLoading = loading;
    setVisible('routeLoading', loading);
    var routeInfo = document.getElementById('routeInfo');
    if (routeInfo) routeInfo.classList.toggle('loading', !!loading);
  }

  function showInstantDistanceAndEta() {
    if (pickupLat == null || pickupLng == null) return;
    var fromLat = lastDriverLat;
    var fromLng = lastDriverLng;
    if (fromLat == null || fromLng == null) return;
    var km = haversineKm(fromLat, fromLng, pickupLat, pickupLng);
    if (km <= 0) return;
    setText('routeDistance', '~' + formatKm(km));
    var etaMin = (km / 25) * 60;
    setText('routeEta', '~' + formatEtaMin(etaMin));
    setRouteLoading(false);
  }

  function formatKm(km) {
    if (km == null || isNaN(km)) return '—';
    return km.toFixed(km < 10 ? 1 : 0) + ' km';
  }

  function formatEtaMin(min) {
    if (min == null || isNaN(min)) return '—';
    if (min < 60) return Math.round(min) + ' daqiqa';
    var h = Math.floor(min / 60);
    var m = Math.round(min % 60);
    return h + ' soat ' + m + ' daqiqa';
  }

  function formatNumberSoM(amount) {
    if (amount == null) return '—';
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function parseFareFromTrip(data) {
    if (!data || typeof data !== 'object') return { fare: null, distance: null };
    var fare = data.fare != null ? data.fare : (data.total_fare != null ? data.total_fare : (data.amount != null ? data.amount : (data.price != null ? data.price : (data.trip_fare != null ? data.trip_fare : null))));
    if (typeof fare === 'object' && fare !== null && (fare.amount != null || fare.value != null)) fare = fare.amount != null ? fare.amount : fare.value;
    if (typeof fare === 'string') fare = parseFloat(fare);
    if (fare != null && isNaN(fare)) fare = null;
    var distance = data.distance_km != null ? data.distance_km : (data.trip_distance != null ? data.trip_distance : (data.distance != null ? data.distance : null));
    if (typeof distance === 'string') distance = parseFloat(distance);
    if (distance != null && isNaN(distance)) distance = null;
    return { fare: fare, distance: distance };
  }

  function updateFareDisplay(fare, distance) {
    var fareEl = document.getElementById('fareValue');
    var distanceEl = document.getElementById('fareDistance');
    if (fareEl) fareEl.textContent = (fare != null && typeof fare === 'number') ? (formatNumberSoM(Math.round(fare)) + " so'm") : '—';
    if (distanceEl) distanceEl.textContent = (distance != null && typeof distance === 'number') ? (distance.toFixed(1) + ' km') : '—';
  }

  function showFinalFareCenter(fare, distance) {
    var overlay = document.getElementById('finalFareOverlay');
    var amountEl = document.getElementById('finalFareAmount');
    var distanceEl = document.getElementById('finalFareDistance');
    if (amountEl) amountEl.textContent = (fare != null && typeof fare === 'number') ? (formatNumberSoM(Math.round(fare)) + " so'm") : '—';
    if (distanceEl) distanceEl.textContent = (distance != null && typeof distance === 'number') ? (distance.toFixed(1) + ' km') : '';
    if (overlay) overlay.classList.add('visible');
  }

  function hideFinalFareCenter() {
    var overlay = document.getElementById('finalFareOverlay');
    if (overlay) overlay.classList.remove('visible');
  }

  // Single source of truth for bottom stats panel (Narx, Masofa). Uses backend trip.distance_km and trip.fare.
  function renderTripStats(trip) {
    if (!trip || typeof trip !== 'object') return;
    var fd = parseFareFromTrip(trip);
    updateFareDisplay(fd.fare, fd.distance);
  }

  // Fetch trip from backend and apply full UI state. Use after start/finish, on WS events, and during live polling.
  function refreshTrip() {
    if (!tripId) return Promise.resolve();
    return fetchTrip().then(function (data) {
      updateFromTrip(data);
    });
  }

  function startLiveTripRefresh() {
    stopLiveTripRefresh();
    if (tripStatus !== 'STARTED') return;
    tripRefreshIntervalId = setInterval(function () {
      if (tripStatus !== 'STARTED') {
        stopLiveTripRefresh();
        return;
      }
      refreshTrip().catch(function () {});
    }, LIVE_TRIP_POLL_INTERVAL_MS);
  }

  function stopLiveTripRefresh() {
    if (tripRefreshIntervalId != null) {
      clearInterval(tripRefreshIntervalId);
      tripRefreshIntervalId = null;
    }
  }

  function vibrateTripStart() {
    try {
      if (navigator.vibrate) navigator.vibrate(200);
    } catch (e) {}
  }

  function startTripRecording() {
    if (lastDriverLat == null || lastDriverLng == null) return;
    tripStartLat = lastDriverLat;
    tripStartLng = lastDriverLng;
    vibrateTripStart();
  }

  function parseCoords(value) {
    if (!value) return null;
    if (Array.isArray(value) && value.length >= 2) {
      var lat = parseFloat(value[0]);
      var lng = parseFloat(value[1]);
      if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
    }
    if (typeof value === 'object' && value !== null) {
      var la = value.lat != null ? value.lat : value.latitude;
      var ln = (value.lng != null ? value.lng : value.longitude != null ? value.longitude : value.lon);
      if (la != null && ln != null) {
        la = parseFloat(la);
        ln = parseFloat(ln);
        if (!isNaN(la) && !isNaN(ln)) return [la, ln];
      }
    }
    return null;
  }

  function fitMapToMarkers() {
    if (!map) return;
    var bounds = [];
    if (pickupMarker) bounds.push(pickupMarker.getLatLng());
    if (driverMarker) bounds.push(driverMarker.getLatLng());
    if (bounds.length >= 2) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    }
  }

  function smoothGpsPosition(lat, lng) {
    gpsHistory.push({ lat: lat, lng: lng, t: Date.now() });
    if (gpsHistory.length > GPS_HISTORY_SIZE) gpsHistory.shift();
    if (gpsHistory.length < 2) return { lat: lat, lng: lng };
    var sumLat = 0, sumLng = 0, n = gpsHistory.length;
    for (var i = 0; i < n; i++) {
      sumLat += gpsHistory[i].lat;
      sumLng += gpsHistory[i].lng;
    }
    return { lat: sumLat / n, lng: sumLng / n };
  }

  function updateFromTrip(data) {
    var prevStatus = tripStatus;
    tripStatus = data.status || '';
    setStatusBanner();

    var pickup = parseCoords(data.pickup) || parseCoords(data.pickup_location)
      || (data.pickup_lat != null && data.pickup_lng != null ? parseCoords([data.pickup_lat, data.pickup_lng]) : null)
      || (data.pickup_location_lat != null && data.pickup_location_lng != null ? parseCoords([data.pickup_location_lat, data.pickup_location_lng]) : null);
    var driver = parseCoords(data.driver);

    clientName = data.rider_name || data.client_name || data.customer_name || data.user_name || data.name || null;
    clientPhone = null;
    if (data.rider_info && typeof data.rider_info === 'object') {
      clientPhone = data.rider_info.phone || data.rider_info.phone_number || null;
      if (!clientName && data.rider_info.name) clientName = data.rider_info.name;
    }
    clientPhone = clientPhone || data.rider_phone || data.client_phone || data.phone || data.customer_phone || null;
    pickupLabel = data.pickup_address || data.pickup_name || data.address || null;

    setText('clientName', clientName || '—');
    setText('clientPhone', clientPhone ? normalizePhoneDisplay(clientPhone) : '—');
    if (pickupLabel) setText('pickupText', '📍 ' + pickupLabel);
    else if (pickup) setText('pickupText', '📍 ' + pickup[0].toFixed(5) + ', ' + pickup[1].toFixed(5));
    else setText('pickupText', '📍 —');

    var callLink = document.getElementById('btnCall');
    if (clientPhone && callLink) {
      callLink.href = 'tel:' + phoneForTelLink(clientPhone);
      setVisible('btnCall', true);
    } else {
      if (callLink) callLink.href = '#';
      setVisible('btnCall', false);
    }

    if (pickup) {
      pickupLat = pickup[0];
      pickupLng = pickup[1];
      if (tripStatus !== 'STARTED' && tripStatus !== 'FINISHED') {
        addPickupMarker(pickup[0], pickup[1]);
      }
    }
    if (driver && (driver[0] !== 0 || driver[1] !== 0)) {
      lastDriverLat = driver[0];
      lastDriverLng = driver[1];
      lastDriverBearingDeg = 0;
      addDriverMarker(driver[0], driver[1], 0);
    }
    if (pickup && (driver || pickupMarker) && (driverMarker || driver) && tripStatus === 'WAITING') {
      fitMapToDriverAndClient();
    } else if (pickup && (driver || pickupMarker) && (driverMarker || driver)) {
      fitMapToMarkers();
    }

    renderTripStats(data);

    if (tripStatus === 'WAITING') {
      hideFinalFareCenter();
      setVisible('routeInfo', true);
      setStatus('Olib ketish joyiga boring, so\'ng SAFARNI BOSHLASH ni bosing.');
      showButton('btnStart', true);
      showButton('btnFinish', false);
      showButton('btnCancel', true);
      tripStartLat = null;
      routeDistanceKm = null;
      routeEtaMin = null;
      setText('routeDistance', '—');
      setText('routeEta', '—');
      if (driver && pickup) {
        showInstantDistanceAndEta();
        lastPickupRouteDrawTime = 0;
        drawRemainingPickupRoute();
        if (!pickupRouteLine) drawPickupHelperLine();
      } else {
        setRouteLoading(false);
      }
    } else if (tripStatus === 'STARTED') {
      hideFinalFareCenter();
      setStatus('Safar davom etmoqda. Tugagach SAFARNI TUGATISH ni bosing.');
      showButton('btnStart', false);
      showButton('btnFinish', true);
      showButton('btnCancel', false);
      setText('routeDistance', '—');
      setText('routeEta', '—');
      setVisible('routeInfo', false);
      clearPickupRoute();
      removePickupMarker();
      if (prevStatus !== 'STARTED') {
        clearTripProgressLine();
        if (lastDriverLat != null && lastDriverLng != null) {
          appendTripProgressPoint(lastDriverLat, lastDriverLng);
        }
        startLiveTripRefresh();
      }
      setRouteLoading(false);
      if (tripStartLat == null && lastDriverLat != null) startTripRecording();
    } else if (tripStatus === 'FINISHED') {
      stopLiveTripRefresh();
      setStatus('Safar tugadi.');
      setRouteLoading(false);
      clearPickupRoute();
      showButton('btnStart', false);
      showButton('btnFinish', false);
      showButton('btnCancel', false);
      stopLocationUpdates();
      var fd = parseFareFromTrip(data);
      showFinalFareCenter(fd.fare, fd.distance);
      setTimeout(function () { refreshTrip().catch(function () {}); }, 1500);
    } else if (tripStatus === 'CANCELLED' || tripStatus === 'CANCELLED_BY_DRIVER' || tripStatus === 'CANCELLED_BY_RIDER') {
      hideFinalFareCenter();
      stopLiveTripRefresh();
      setStatus(tripStatus === 'CANCELLED_BY_RIDER' ? 'Mijoz bekor qildi.' : 'Safar bekor qilindi.');
      setRouteLoading(false);
      clearPickupRoute();
      clearTripProgressLine();
      showButton('btnStart', false);
      showButton('btnFinish', false);
      showButton('btnCancel', false);
      stopLocationUpdates();
    }
  }

  function fitMapToDriverAndClient() {
    if (!map) return;
    var bounds = [];
    if (pickupLat != null && pickupLng != null) bounds.push([pickupLat, pickupLng]);
    if (lastDriverLat != null && lastDriverLng != null) bounds.push([lastDriverLat, lastDriverLng]);
    if (bounds.length >= 2) {
      map.fitBounds(bounds, { padding: [80, 40, 80, 40], maxZoom: 16 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    }
  }

  function maybeRefetchTripForFare() {
    if (tripStatus !== 'STARTED') return;
    var now = Date.now();
    if (now - lastTripRefetchTime < TRIP_REFETCH_INTERVAL_MS) return;
    lastTripRefetchTime = now;
    fetchTrip().then(function (data) {
      var fd = parseFareFromTrip(data);
      updateFareDisplay(fd.fare, fd.distance);
    }).catch(function () {});
  }

  function startLocationUpdates() {
    if (locationWatchId != null) return;
    function onPos(position) {
      var acc = position.coords.accuracy;
      if (acc > GPS_ACCURACY_MAX_METERS) return;
      var lat = position.coords.latitude;
      var lng = position.coords.longitude;
      var smoothed = smoothGpsPosition(lat, lng);
      lat = smoothed.lat;
      lng = smoothed.lng;
      var bearing = lastDriverBearingDeg || 0;
      if (lastDriverLat != null && lastDriverLng != null) {
        var movedKm = haversineKm(lastDriverLat, lastDriverLng, lat, lng);
        if (movedKm >= 0.005) { // >= 5 meters
          bearing = calculateBearing(lastDriverLat, lastDriverLng, lat, lng);
        }
      }
      lastDriverLat = lat;
      lastDriverLng = lng;
      lastDriverBearingDeg = bearing;
      sendDriverLocation(lat, lng).then(function () {
        addDriverMarker(lat, lng, bearing);
      });
      if (tripStatus === 'WAITING') {
        checkRouteDeviationAndRecalc(lat, lng);
        drawRemainingPickupRoute();
        fitMapToDriverAndClient();
      } else if (tripStatus === 'STARTED') {
        appendTripProgressPoint(lat, lng);
        maybeRefetchTripForFare();
        fitMapToDriver();
      }
    }
    function onErr() {}
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true });
      locationWatchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000 });
    }
  }

  function stopLocationUpdates() {
    if (locationWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
      navigator.geolocation.clearWatch(locationWatchId);
    }
    locationWatchId = null;
    disconnectWebSocket();
  }

  function showMissingParams() {
    var el = document.getElementById('missing-params');
    if (el) el.classList.add('visible');
  }

  function run() {
    tripId = getTripId();
    driverId = getDriverId();
    if (!tripId || !driverId) {
      showMissingParams();
      setStatus('URLda trip_id yoki driver_id topilmadi');
      return;
    }

    initMap();
    setStatus('Reja yuklanmoqda…');
    connectWebSocket();

    refreshTrip()
      .then(function () { startLocationUpdates(); })
      .catch(function () {
        setStatus('Reja topilmadi');
      });

    function openPhoneDialer(telUrl) {
      try {
        if (typeof Telegram !== 'undefined' && Telegram.WebApp && typeof Telegram.WebApp.openLink === 'function') {
          Telegram.WebApp.openLink(telUrl);
          return;
        }
      } catch (e) {}
      try {
        var a = document.createElement('a');
        a.href = telUrl;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        window.location.href = telUrl;
      }
    }
    var callBtn = document.getElementById('btnCall');
    if (callBtn) {
      callBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!clientPhone) return;
        openPhoneDialer('tel:' + phoneForTelLink(clientPhone));
      });
    }

    document.getElementById('btnStart').addEventListener('click', function () {
      var btn = this;
      var prevText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      startTrip()
        .then(function () {
          startTripRecording();
          tripStatus = 'STARTED';
          setStatusBanner();
          updateFromTrip({ status: 'STARTED' });
          refreshTrip().then(function (data) { if (data) updateFromTrip(data); }).catch(function () {});
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = prevText;
          var msg = (err && err.message ? err.message : '') + (err && err.status ? ' ' + err.status : '');
          if (msg.indexOf('401') !== -1 || msg.indexOf('Unauthorized') !== -1) {
            showBannerError('Haydovchi tasdiqlanmadi. Mini App ni Telegram orqali oching.');
          } else {
            showBannerError('Safarni boshlash muvaffaqiyatsiz. Qaytadan urinib ko\'ring.');
          }
          setTimeout(setStatusBanner, 8000);
          if (typeof console !== 'undefined' && console.error) console.error('Start trip failed:', err);
        });
    });

    document.getElementById('btnFinish').addEventListener('click', function () {
      var btn = this;
      var prevText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      finishTrip()
        .then(function () {
          updateFromTrip({ status: 'FINISHED' });
          refreshTrip().then(function (data) { if (data) updateFromTrip(data); }).catch(function () {});
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = prevText;
          updateFromTrip({ status: 'FINISHED' });
        });
    });

    var btnCancel = document.getElementById('btnCancel');
    if (btnCancel) {
      btnCancel.addEventListener('click', function () {
        var btn = this;
        var prevText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '…';
        cancelTrip()
          .then(function () {
            updateFromTrip({ status: 'CANCELLED' });
            refreshTrip().then(function (data) { if (data) updateFromTrip(data); }).catch(function () {});
          })
          .catch(function (err) {
            showBannerError('Safarni bekor qilish muvaffaqiyatsiz. Qaytadan urinib ko\'ring.');
            setTimeout(setStatusBanner, 6000);
            if (typeof console !== 'undefined' && console.error) console.error('Cancel trip failed:', err);
          })
          .finally(function () {
            btn.disabled = false;
            btn.textContent = prevText;
          });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
