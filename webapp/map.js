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
  var followDriverMode = false;
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
  var PICKUP_ROUTE_REDRAW_INTERVAL_MS = 5000;
  var TRIP_REFETCH_INTERVAL_MS = 10000;
  var ROUTE_DEVIATION_METERS = 50;
  var GPS_ACCURACY_MAX_METERS = 50;
  var gpsHistory = [];
  var GPS_HISTORY_SIZE = 3;

  var API_BASE = 'https://taxi-service-on-telegram.onrender.com';

  function getWsUrl() {
    var base = API_BASE;
    if (base.indexOf('https://') === 0) return base.replace('https://', 'wss://') + '/ws';
    if (base.indexOf('http://') === 0) return base.replace('http://', 'ws://') + '/ws';
    return 'wss://' + base + '/ws';
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

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setVisible(id, visible) {
    var el = document.getElementById(id);
    if (el) el.style.display = visible ? 'block' : 'none';
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
    if (tripStatus === 'WAITING') holat = 'Mijozga ketilyapti';
    else if (tripStatus === 'STARTED') holat = 'Safar boshlandi';
    else if (tripStatus === 'FINISHED') holat = 'Safar tugadi';
    else if (tripStatus === 'CANCELLED' || tripStatus === 'CANCELLED_BY_DRIVER') holat = 'Safar bekor qilindi';
    else if (tripStatus === 'CANCELLED_BY_RIDER') holat = 'Mijoz bekor qildi';
    setText('statusText', holat);
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
        if (!r.ok) throw new Error('Trip not found');
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

  // Backend (taxi-service-on-telegram): POST body is { "trip_id": "..." }; driver comes from auth context.
  function startTrip() {
    return fetch(API_BASE + '/trip/start', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ trip_id: String(tripId) })
    }).then(function (r) {
      if (!r.ok) {
        var e = new Error(r.status === 401 ? '401 Unauthorized' : 'Start failed');
        e.status = r.status;
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
      body: JSON.stringify({ trip_id: String(tripId) })
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
      body: JSON.stringify({ trip_id: String(tripId) })
    }).then(function (r) {
      if (!r.ok) throw new Error('Cancel failed');
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
      ws.onopen = function () {
        ws.send(JSON.stringify({ type: 'subscribe', trip_id: tripId, driver_id: driverId }));
      };
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          var type = msg.type || msg.event;
          var payload = msg.payload || msg;
          if (type === 'driver_location_update' && msg.lat != null && msg.lng != null) {
            lastDriverLat = parseFloat(msg.lat);
            lastDriverLng = parseFloat(msg.lng);
            addDriverMarker(lastDriverLat, lastDriverLng);
            if (tripStatus === 'WAITING') {
              drawRemainingPickupRoute();
              if (followDriverMode) fitMapToDriverAndClient();
            } else if (tripStatus === 'STARTED') {
              appendTripProgressPoint(lastDriverLat, lastDriverLng);
              maybeRefetchTripForFare();
            }
          } else if (type === 'trip_started') {
            tripStatus = 'STARTED';
            fetchTrip().then(updateFromTrip).catch(function () { updateFromTrip({ status: 'STARTED' }); });
          } else if (type === 'trip_finished') {
            tripStatus = 'FINISHED';
            fetchTrip().then(updateFromTrip).catch(function () { updateFromTrip({ status: 'FINISHED' }); });
          } else if (type === 'trip_cancelled') {
            var status = (payload.trip_status || payload.status || 'CANCELLED');
            if (status === 'CANCELLED_BY_RIDER' || status === 'CANCELLED_BY_DRIVER') {
              tripStatus = status;
            } else {
              tripStatus = 'CANCELLED';
            }
            fetchTrip().then(updateFromTrip).catch(function () {
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
  }

  function getClientIconSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 52" width="40" height="52">' +
      '<path d="M20 0C12.3 0 6 6.3 6 14c0 5.2 3.2 9.6 7.6 11.4L6 52h28l-7.6-26.6c4.4-1.8 7.6-6.2 7.6-11.4C34 6.3 27.7 0 20 0z" fill="#2563eb" stroke="#1e40af" stroke-width="1.5"/>' +
      '<circle cx="20" cy="14" r="8" fill="#fff"/>' +
      '<circle cx="20" cy="14" r="5" fill="#1e293b"/>' +
      '<path d="M12 24h16v6c0 2-1.5 4-4 4h-8c-2.5 0-4-2-4-4v-6z" fill="#fff"/>' +
      '</svg>';
  }

  function addPickupMarker(lat, lng) {
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'pickup-marker client-marker',
        html: getClientIconSvg(),
        iconSize: [40, 52],
        iconAnchor: [20, 52]
      })
    }).addTo(map).bindPopup('Mijoz / Olib ketish joyi');
  }

  function addDriverMarker(lat, lng) {
    if (driverMarker) map.removeLayer(driverMarker);
    driverMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'driver-marker', html: '&#128663;', iconSize: [36, 36], iconAnchor: [18, 36] })
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

  function drawPickupHelperLine() {
    if (!map || !pickupLat || !pickupLng || lastDriverLat == null || lastDriverLng == null) return;
    if (pickupHelperLine) map.removeLayer(pickupHelperLine);
    pickupHelperLine = L.polyline([[lastDriverLat, lastDriverLng], [pickupLat, pickupLng]], {
      color: '#2563eb',
      weight: 4,
      opacity: 0.7,
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
      weight: 6,
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
          pickupRouteLine = L.polyline(latLngs, {
            color: '#2563eb',
            weight: 7,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
            className: 'route-line-highlight'
          }).addTo(map);
          routeDistanceKm = route.distance / 1000.0;
          routeEtaMin = route.duration / 60.0;
          setText('routeDistance', formatKm(routeDistanceKm));
          setText('routeEta', formatEtaMin(routeEtaMin));
          if (followDriverMode) fitMapToDriverAndClient();
          else map.fitBounds(pickupRouteLine.getBounds(), { padding: [50, 50], maxZoom: 15 });
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
      addPickupMarker(pickup[0], pickup[1]);
    }
    if (driver && (driver[0] !== 0 || driver[1] !== 0)) {
      lastDriverLat = driver[0];
      lastDriverLng = driver[1];
      addDriverMarker(driver[0], driver[1]);
    }
    if (pickup && (driver || pickupMarker) && (driverMarker || driver) && !followDriverMode) {
      fitMapToMarkers();
    }

    var fareData = parseFareFromTrip(data);
    updateFareDisplay(fareData.fare, fareData.distance);

    if (tripStatus === 'WAITING') {
      setStatus('Olib ketish joyiga boring, so\'ng SAFARNI BOSHLASH ni bosing.');
      updateTrackButtonLabel();
      showButton('btnTrackToClient', true);
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
      } else {
        setRouteLoading(false);
      }
    } else if (tripStatus === 'STARTED') {
      setStatus('Safar davom etmoqda. Tugagach SAFARNI TUGATISH ni bosing.');
      followDriverMode = false;
      showButton('btnTrackToClient', false);
      showButton('btnStart', false);
      showButton('btnFinish', true);
      showButton('btnCancel', false);
      if (prevStatus !== 'STARTED') {
        clearPickupRoute();
        clearTripProgressLine();
        if (lastDriverLat != null && lastDriverLng != null) {
          appendTripProgressPoint(lastDriverLat, lastDriverLng);
        }
      }
      setRouteLoading(false);
      if (tripStartLat == null && lastDriverLat != null) startTripRecording();
    } else if (tripStatus === 'FINISHED') {
      setStatus('Safar tugadi.');
      followDriverMode = false;
      updateTrackButtonLabel();
      setRouteLoading(false);
      clearPickupRoute();
      showButton('btnTrackToClient', false);
      showButton('btnStart', false);
      showButton('btnFinish', false);
      showButton('btnCancel', false);
      stopLocationUpdates();
    } else if (tripStatus === 'CANCELLED' || tripStatus === 'CANCELLED_BY_DRIVER' || tripStatus === 'CANCELLED_BY_RIDER') {
      setStatus(tripStatus === 'CANCELLED_BY_RIDER' ? 'Mijoz bekor qildi.' : 'Safar bekor qilindi.');
      followDriverMode = false;
      setRouteLoading(false);
      clearPickupRoute();
      clearTripProgressLine();
      showButton('btnTrackToClient', false);
      showButton('btnStart', false);
      showButton('btnFinish', false);
      showButton('btnCancel', false);
      stopLocationUpdates();
    }
  }

  function ensureRouteToClient() {
    if (!pickupLat || !pickupLng || !map) return;
    if (lastDriverLat == null || lastDriverLng == null) return;
    if (pickupRouteLine) {
      fitMapToDriverAndClient();
      return;
    }
    lastPickupRouteDrawTime = 0;
    drawRemainingPickupRoute();
  }

  function startInAppNavigation() {
    if (pickupLat == null || pickupLng == null) return;
    followDriverMode = true;
    setStatus('Joylashuvingiz mijozga nisbatan kuzatilmoqda');
    updateTrackButtonLabel();
    showInstantDistanceAndEta();
    if (!pickupRouteLine) drawPickupHelperLine();
    fitMapToDriverAndClient();
    ensureRouteToClient();
  }

  function stopInAppNavigation() {
    followDriverMode = false;
    if (pickupHelperLine && map) {
      map.removeLayer(pickupHelperLine);
      pickupHelperLine = null;
    }
    setStatus('Olib ketish joyiga boring, so\'ng SAFARNI BOSHLASH ni bosing.');
    updateTrackButtonLabel();
  }

  function updateTrackButtonLabel() {
    var btn = document.getElementById('btnTrackToClient');
    if (btn && tripStatus === 'WAITING') btn.textContent = followDriverMode ? 'Kuzatishni to\'xtatish' : 'Mijozga yo\'l';
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

  function updateMapFollowDriver(lat, lng) {
    if (!followDriverMode || !map) return;
    lastDriverLat = lat;
    lastDriverLng = lng;
    fitMapToDriverAndClient();
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
      lastDriverLat = lat;
      lastDriverLng = lng;
      sendDriverLocation(lat, lng).then(function () {
        addDriverMarker(lat, lng);
      });
      if (tripStatus === 'WAITING') {
        checkRouteDeviationAndRecalc(lat, lng);
        drawRemainingPickupRoute();
        if (followDriverMode) updateMapFollowDriver(lat, lng);
      } else if (tripStatus === 'STARTED') {
        appendTripProgressPoint(lat, lng);
        maybeRefetchTripForFare();
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

    fetchTrip()
      .then(function (data) {
        updateFromTrip(data);
        startLocationUpdates();
      })
      .catch(function () {
        setStatus('Reja topilmadi');
      });

    var callBtn = document.getElementById('btnCall');
    if (callBtn) {
      callBtn.addEventListener('click', function (e) {
        if (!clientPhone) {
          e.preventDefault();
          return;
        }
        try {
          if (typeof Telegram !== 'undefined' && Telegram.WebApp && typeof Telegram.WebApp.openLink === 'function') {
            e.preventDefault();
            Telegram.WebApp.openLink('tel:' + phoneForTelLink(clientPhone));
            return;
          }
        } catch (err) {}
      });
    }

    document.getElementById('btnTrackToClient').addEventListener('click', function () {
      if (followDriverMode) {
        stopInAppNavigation();
      } else {
        startInAppNavigation();
      }
    });

    document.getElementById('btnStart').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      startTrip()
        .then(function () {
          startTripRecording();
          return fetchTrip()
            .then(updateFromTrip)
            .catch(function () {
              updateFromTrip({ status: 'STARTED' });
            });
        })
        .then(function () {
          tripStatus = 'STARTED';
          setStatusBanner();
        })
        .catch(function (err) {
          btn.disabled = false;
          var msg = (err && err.message ? err.message : '') + (err && err.status ? ' ' + err.status : '');
          if (msg.indexOf('401') !== -1 || msg.indexOf('Unauthorized') !== -1) {
            setStatus('Haydovchi tasdiqlanmadi. Mini App ni Telegram orqali oching.');
          } else {
            setStatus('Safarni boshlash muvaffaqiyatsiz. Qaytadan urinib ko\'ring.');
          }
          if (typeof console !== 'undefined' && console.error) console.error('Start trip failed:', err);
        });
    });

    document.getElementById('btnFinish').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      finishTrip()
        .then(function () {
          return fetchTrip();
        })
        .then(function (data) {
          updateFromTrip(data);
        })
        .catch(function () {
          updateFromTrip({ status: 'FINISHED' });
          btn.disabled = false;
        });
    });

    var btnCancel = document.getElementById('btnCancel');
    if (btnCancel) {
      btnCancel.addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        cancelTrip()
          .then(function () {
            return fetchTrip();
          })
          .then(function (data) {
            updateFromTrip(data);
          })
          .catch(function () {
            tripStatus = 'CANCELLED_BY_DRIVER';
            setStatusBanner();
            setStatus('Safar bekor qilindi.');
            showButton('btnTrackToClient', false);
            showButton('btnStart', false);
            showButton('btnFinish', false);
            showButton('btnCancel', false);
            stopLocationUpdates();
          })
          .finally(function () {
            btn.disabled = false;
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
