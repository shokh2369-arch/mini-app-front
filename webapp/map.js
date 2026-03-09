(function () {
  'use strict';

  var map, pickupMarker, driverMarker, routeLayer;
  var tripId, driverId;
  var tripStatus = '';
  var locationWatchId = null;
  var refreshIntervalId = null;
  // Replace with your Go backend URL when deploying (e.g. https://your-api.railway.app). No trailing slash.
  var API_BASE = 'https://taxi-service-on-telegram.onrender.com';

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || params.get(name);
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
    if (id) return parseInt(id, 10);
    return null;
  }

  function setStatus(text) {
    var el = document.getElementById('status');
    if (el) el.textContent = text;
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
    map = L.map('map').setView([41.3, 69.2], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
  }

  function addPickupMarker(lat, lng) {
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'pickup-marker', html: '&#128205;', iconSize: [24, 24] })
    }).addTo(map).bindPopup('Pickup');
  }

  function addDriverMarker(lat, lng) {
    if (driverMarker) map.removeLayer(driverMarker);
    driverMarker = L.marker([lat, lng], {
      icon: L.divIcon({ className: 'driver-marker', html: '&#128663;', iconSize: [24, 24] })
    }).addTo(map).bindPopup('Driver');
  }

  function drawRoute(geojsonCoords) {
    if (routeLayer) map.removeLayer(routeLayer);
    if (!geojsonCoords || geojsonCoords.length < 2) return;
    var latLngs = geojsonCoords.map(function (c) { return [c[1], c[0]]; });
    routeLayer = L.polyline(latLngs, { color: '#2563eb', weight: 4 }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  }

  function updateFromTrip(data) {
    tripStatus = data.status || '';
    var pickup = data.pickup;
    var driver = data.driver;
    if (pickup && pickup.length >= 2) {
      addPickupMarker(pickup[0], pickup[1]);
    }
    if (driver && driver.length >= 2 && (driver[0] !== 0 || driver[1] !== 0)) {
      addDriverMarker(driver[0], driver[1]);
    }

    if (tripStatus === 'WAITING') {
      setStatus('Go to pickup, then press START TRIP');
      showButton('btnStart', true);
      showButton('btnFinish', false);
      if (driver && pickup && driver.length >= 2 && pickup.length >= 2) {
        fetchRoute(driver[0], driver[1], pickup[0], pickup[1]).then(function (json) {
          if (json.routes && json.routes[0] && json.routes[0].geometry && json.routes[0].geometry.coordinates) {
            drawRoute(json.routes[0].geometry.coordinates);
          }
        }).catch(function () {});
      }
    } else if (tripStatus === 'STARTED') {
      setStatus('Trip in progress. Press FINISH TRIP when done.');
      showButton('btnStart', false);
      showButton('btnFinish', true);
      if (routeLayer) map.removeLayer(routeLayer);
      routeLayer = null;
    } else if (tripStatus === 'FINISHED') {
      setStatus('Trip finished.');
      showButton('btnStart', false);
      showButton('btnFinish', false);
      stopLocationUpdates();
    }
  }

  function startLocationUpdates() {
    if (locationWatchId != null) return;
    function onPos(position) {
      var lat = position.coords.latitude;
      var lng = position.coords.longitude;
      sendDriverLocation(lat, lng).then(function () {
        addDriverMarker(lat, lng);
      });
    }
    function onErr() {}
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true });
      navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000 });
      locationWatchId = 1;
    }
  }

  function stopLocationUpdates() {
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
      setStatus('Missing trip_id or driver_id in URL');
      return;
    }

    initMap();
    setStatus('Loading trip…');

    fetchTrip()
      .then(function (data) {
        updateFromTrip(data);
        var pickup = data.pickup;
        if (pickup && pickup.length >= 2) {
          map.setView([pickup[0], pickup[1]], 14);
        }
        startLocationUpdates();
        refreshLoop();
      })
      .catch(function () {
        setStatus('Trip not found');
      });

    document.getElementById('btnStart').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      startTrip()
        .then(function () {
          fetchTrip().then(updateFromTrip);
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

