(function () {
  'use strict';

  var map, pickupMarker, driverMarker, routeLayer;
  var tripId, driverId;
  var tripStatus = '';
  var pickupLat, pickupLng;
  var lastDriverLat, lastDriverLng;
  var followDriverMode = false;
  var locationWatchId = null;
  var refreshIntervalId = null;
  var tripStartLat, tripStartLng;
  var lastFareLat, lastFareLng;
  var totalDistanceKm = 0;
  var currentFare = null;
  var routeDistanceKm = null;
  var routeEtaMin = null;
  var isRouteLoading = false;
  var clientPhone = null;
  var clientName = null;
  var pickupLabel = null;
  // Replace with your Go backend URL when deploying (e.g. https://your-api.railway.app). No trailing slash.
  var API_BASE = 'https://taxi-service-on-telegram.onrender.com';
  // Tariff: 4,000 so'm base price + 1,500 so'm per kilometer (counted from when driver starts trip)
  var BASE_FARE = 4000;     // boshlang'ich narx (so'm)
  var PER_KM_FARE = 1500;   // har kilometr uchun (so'm)

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

  function setStatusBanner() {
    var holat = 'Yuklanmoqda…';
    if (tripStatus === 'WAITING') holat = 'Mijozga ketilyapti';
    else if (tripStatus === 'STARTED') holat = 'Safar boshlandi';
    else if (tripStatus === 'FINISHED') holat = 'Safar tugadi';
    setText('statusText', holat);
  }

  function showButton(id, show) {
    var el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_id: driverId, lat: lat, lng: lng })
    });
  }

  function startTrip() {
    return fetch(API_BASE + '/trip/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trip_id: tripId, driver_id: driverId })
    }).then(function (r) {
      if (!r.ok) throw new Error('Start failed');
      return r.json();
    });
  }

  function finishTrip() {
    return fetch(API_BASE + '/trip/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trip_id: tripId, driver_id: driverId })
    }).then(function (r) {
      if (!r.ok) throw new Error('Finish failed');
      return r.json();
    });
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
    // Softer, readable map style (CartoDB Positron)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
  }

  function getClientIconSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="28" height="36">' +
      '<rect x="0.5" y="0.5" width="23" height="31" rx="2" fill="#fff" stroke="#1e293b" stroke-width="1.5"/>' +
      '<circle cx="12" cy="8" r="4" fill="#1e293b"/>' +
      '<rect x="7" y="14" width="10" height="8" rx="2" fill="#1e293b"/>' +
      '<rect x="6" y="22" width="4" height="8" rx="1" fill="#1e293b"/>' +
      '<rect x="14" y="22" width="4" height="8" rx="1" fill="#1e293b"/>' +
      '</svg>';
  }

  function addPickupMarker(lat, lng) {
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'pickup-marker client-marker',
        html: getClientIconSvg(),
        iconSize: [28, 36],
        iconAnchor: [14, 36]
      })
    }).addTo(map).bindPopup('Mijoz / Olib ketish joyi');
  }

  function addDriverMarker(lat, lng) {
    if (driverMarker) map.removeLayer(driverMarker);
    driverMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'driver-marker', html: '&#128663;', iconSize: [32, 32], iconAnchor: [16, 32] })
    }).addTo(map).bindPopup('Haydovchi');
  }

  function drawRoute(geojsonCoords) {
    if (routeLayer) map.removeLayer(routeLayer);
    if (!geojsonCoords || geojsonCoords.length < 2) return;
    var latLngs = geojsonCoords.map(function (c) { return [c[1], c[0]]; });
    routeLayer = L.polyline(latLngs, {
      color: '#2563eb',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [50, 50], maxZoom: 15 });
  }

  function setRouteLoading(loading) {
    isRouteLoading = loading;
    setVisible('routeLoading', loading);
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

  function updateFareText() {
    if (tripStatus !== 'STARTED' && tripStatus !== 'FINISHED') {
      setText('fareValue', '—');
      setText('fareDistance', '—');
      return;
    }
    if (currentFare == null) {
      setText('fareValue', '—');
      setText('fareDistance', '—');
      return;
    }
    var kmText = totalDistanceKm.toFixed(1);
    setText('fareValue', formatNumberSoM(currentFare) + " so'm");
    setText('fareDistance', kmText + ' km');
  }

  function startTripRecording() {
    if (lastDriverLat == null || lastDriverLng == null) return;
    tripStartLat = lastDriverLat;
    tripStartLng = lastDriverLng;
    lastFareLat = lastDriverLat;
    lastFareLng = lastDriverLng;
    totalDistanceKm = 0;
    currentFare = BASE_FARE;
    updateFareText();
  }

  function addDistanceAndUpdateFare(lat, lng) {
    if (lastFareLat == null || lastFareLng == null) return;
    var km = haversineKm(lastFareLat, lastFareLng, lat, lng);
    totalDistanceKm += km;
    lastFareLat = lat;
    lastFareLng = lng;
    currentFare = BASE_FARE + Math.round(totalDistanceKm * PER_KM_FARE);
    updateFareText();
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

  function updateFromTrip(data) {
    tripStatus = data.status || '';
    setStatusBanner();

    var pickup = parseCoords(data.pickup) || parseCoords(data.pickup_location)
      || (data.pickup_lat != null && data.pickup_lng != null ? parseCoords([data.pickup_lat, data.pickup_lng]) : null)
      || (data.pickup_location_lat != null && data.pickup_location_lng != null ? parseCoords([data.pickup_location_lat, data.pickup_location_lng]) : null);
    var driver = parseCoords(data.driver);

    // Client info (best-effort from backend fields)
    clientName = data.client_name || data.customer_name || data.user_name || data.name || null;
    clientPhone = data.client_phone || data.phone || data.customer_phone || null;
    pickupLabel = data.pickup_address || data.pickup_name || data.address || null;

    setText('clientName', clientName || '—');
    if (pickupLabel) setText('pickupText', '📍 ' + pickupLabel);
    else if (pickup) setText('pickupText', '📍 ' + pickup[0].toFixed(5) + ', ' + pickup[1].toFixed(5));
    else setText('pickupText', '📍 —');

    if (clientPhone) {
      setVisible('btnCall', true);
    } else {
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

    if (tripStatus === 'WAITING') {
      setStatus('Olib ketish joyiga boring, so\'ng SAFARNI BOSHLASH ni bosing.');
      updateTrackButtonLabel();
      showButton('btnTrackToClient', true);
      showButton('btnStart', true);
      showButton('btnFinish', false);
      tripStartLat = null;
      lastFareLat = null;
      totalDistanceKm = 0;
      currentFare = null;
      routeDistanceKm = null;
      routeEtaMin = null;
      setText('routeDistance', '—');
      setText('routeEta', '—');
      if (driver && pickup) {
        setRouteLoading(true);
        fetchRoute(driver[0], driver[1], pickup[0], pickup[1]).then(function (json) {
          if (json.routes && json.routes[0] && json.routes[0].geometry && json.routes[0].geometry.coordinates) {
            drawRoute(json.routes[0].geometry.coordinates);
          }
          if (json.routes && json.routes[0]) {
            routeDistanceKm = json.routes[0].distance / 1000.0;
            routeEtaMin = json.routes[0].duration / 60.0;
            setText('routeDistance', formatKm(routeDistanceKm));
            setText('routeEta', formatEtaMin(routeEtaMin));
          }
          setRouteLoading(false);
        }).catch(function () {});
      } else {
        setRouteLoading(false);
      }
      updateFareText();
    } else if (tripStatus === 'STARTED') {
      setStatus('Safar davom etmoqda. Tugagach SAFARNI TUGATISH ni bosing.');
      followDriverMode = false;
      showButton('btnTrackToClient', false);
      showButton('btnStart', false);
      showButton('btnFinish', true);
      if (routeLayer) map.removeLayer(routeLayer);
      routeLayer = null;
      setRouteLoading(false);
      if (tripStartLat == null && lastDriverLat != null) startTripRecording();
      updateFareText();
    } else if (tripStatus === 'FINISHED') {
      setStatus('Safar tugadi.');
      followDriverMode = false;
      updateTrackButtonLabel();
      setRouteLoading(false);
      updateFareText();
      showButton('btnTrackToClient', false);
      showButton('btnStart', false);
      showButton('btnFinish', false);
      stopLocationUpdates();
    }
  }

  function startInAppNavigation() {
    if (pickupLat == null || pickupLng == null) return;
    followDriverMode = true;
    setStatus('Joylashuvingiz mijozga nisbatan kuzatilmoqda');
    updateTrackButtonLabel();
    // Keep route visible, but follow driver marker (center on driver)
    if (lastDriverLat != null && lastDriverLng != null && map) map.setView([lastDriverLat, lastDriverLng], Math.max(map.getZoom(), 15));
  }

  function stopInAppNavigation() {
    followDriverMode = false;
    setStatus('Olib ketish joyiga boring, so\'ng SAFARNI BOSHLASH ni bosing.');
    updateTrackButtonLabel();
  }

  function updateTrackButtonLabel() {
    var btn = document.getElementById('btnTrackToClient');
    if (btn && tripStatus === 'WAITING') btn.textContent = followDriverMode ? 'Kuzatishni to\'xtatish' : 'Mijozga yo\'l';
  }

  function fitMapToDriverAndClient() {
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
    // Driver auto-follow (keep centered)
    map.panTo([lat, lng], { animate: true, duration: 0.25 });
  }

  function startLocationUpdates() {
    if (locationWatchId != null) return;
    function onPos(position) {
      var lat = position.coords.latitude;
      var lng = position.coords.longitude;
      lastDriverLat = lat;
      lastDriverLng = lng;
      sendDriverLocation(lat, lng).then(function () {
        addDriverMarker(lat, lng);
      });
      if (followDriverMode) updateMapFollowDriver(lat, lng);
      if (tripStatus === 'STARTED') addDistanceAndUpdateFare(lat, lng);
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
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
  }

  function refreshLoop() {
    refreshIntervalId = setInterval(function () {
      fetchTrip().then(updateFromTrip).catch(function () {});
    }, 3000);
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

    fetchTrip()
      .then(function (data) {
        updateFromTrip(data);
        startLocationUpdates();
        refreshLoop();
      })
      .catch(function () {
        setStatus('Reja topilmadi');
      });

    var callBtn = document.getElementById('btnCall');
    if (callBtn) {
      callBtn.addEventListener('click', function () {
        if (!clientPhone) return;
        window.location.href = 'tel:' + clientPhone;
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
          return fetchTrip().then(updateFromTrip);
        })
        .catch(function () {
          btn.disabled = false;
        });
    });

    document.getElementById('btnFinish').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      finishTrip()
        .then(function () {
          updateFromTrip({ status: 'FINISHED' });
        })
        .catch(function () {
          btn.disabled = false;
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

