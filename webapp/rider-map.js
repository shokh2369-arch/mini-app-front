(function () {
  'use strict';

  var map, pickupMarker, driverMarker;
  var routeLine = null;
  var tripId = null;
  var tripStatus = '';
  var pickupLat, pickupLng;
  var driverLat, driverLng;
  var driverBearingDeg = 0;
  var driverPhone = null;
  var driverName = null;
  var driverCarInfo = null;
  var ws = null;
  var wsReconnectTimer = null;
  var isRouteLoading = false;
  var API_BASE = 'https://taxi-2r2j.onrender.com';

  function getWsUrl() {
    var base = API_BASE;
    var scheme = 'wss://';
    if (base.indexOf('https://') === 0) {
      base = base.replace('https://', '');
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
    try {
      if (typeof Telegram !== 'undefined' && Telegram.WebApp && Telegram.WebApp.startParam) {
        var start = Telegram.WebApp.startParam;
        if (start && start.indexOf('trip_') === 0) return start.replace('trip_', '');
      }
    } catch (e) {}
    return null;
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
    if (tripStatus === 'WAITING') holat = 'Haydovchi yo\'lda';
    else if (tripStatus === 'STARTED') holat = 'Safar boshlandi';
    else if (tripStatus === 'FINISHED') holat = 'Safar tugadi';
    else if (tripStatus === 'CANCELLED' || tripStatus === 'CANCELLED_BY_DRIVER') holat = 'Safar bekor qilindi';
    else if (tripStatus === 'CANCELLED_BY_RIDER') holat = 'Safar bekor qilindi';
    setText('statusText', holat);
  }

  function apiHeaders() {
    var h = { 'Content-Type': 'application/json' };
    try {
      if (typeof Telegram !== 'undefined' && Telegram.WebApp && Telegram.WebApp.initData) {
        h['X-Telegram-Init-Data'] = Telegram.WebApp.initData;
      }
    } catch (e) {}
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

  function cancelTrip() {
    return fetch(API_BASE + '/trip/cancel/rider', {
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
      ws.onopen = function () {};
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          var type = msg.type || msg.event;
          var payload = msg.payload || msg;
          if (type === 'driver_location_update' && msg.lat != null && msg.lng != null) {
            var newLat = parseFloat(msg.lat);
            var newLng = parseFloat(msg.lng);
            var bearing = driverBearingDeg || 0;
            if (driverLat != null && driverLng != null) {
              var movedKm = haversineKm(driverLat, driverLng, newLat, newLng);
              if (movedKm >= 0.005) {
                bearing = calculateBearing(driverLat, driverLng, newLat, newLng);
              }
            }
            driverBearingDeg = bearing;
            addDriverMarker(newLat, newLng, bearing);
            driverLat = newLat;
            driverLng = newLng;
            if (pickupLat != null && pickupLng != null) drawRoute();
          } else if (type === 'trip_started') {
            tripStatus = 'STARTED';
            setStatusBanner();
            fetchTrip().then(applyTripData).catch(function () {});
          } else if (type === 'trip_finished') {
            tripStatus = 'FINISHED';
            setStatusBanner();
            setVisible('btnCallDriver', false);
            setVisible('btnCancelTrip', false);
            clearRoute();
          } else if (type === 'trip_cancelled') {
            var st = (payload.trip_status || payload.status || 'CANCELLED');
            tripStatus = (st === 'CANCELLED_BY_RIDER' || st === 'CANCELLED_BY_DRIVER') ? st : 'CANCELLED';
            setStatusBanner();
            setVisible('btnCallDriver', false);
            setVisible('btnCancelTrip', false);
            clearRoute();
          }
        } catch (e) {}
      };
      ws.onclose = function () {
        ws = null;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(connectWebSocket, 3000);
      };
      ws.onerror = function () {};
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

  var RIDER_ICON_URL = 'images/rider-pin-transparent.png';

  function addPickupMarker(lat, lng) {
    if (pickupMarker && map) map.removeLayer(pickupMarker);
    pickupMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'pickup-marker',
        html: '<img src=\"' + RIDER_ICON_URL + '\" alt=\"Sizning joyingiz\" class=\"rider-pin-icon\"/>',
        iconSize: [70, 70],
        iconAnchor: [35, 35]
      })
    }).addTo(map).bindPopup('Sizning joyingiz');
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
    if (driverMarker && map) map.removeLayer(driverMarker);
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

  function clearRoute() {
    if (routeLine && map) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    setText('routeDistance', '—');
    setText('routeEta', '—');
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

  function drawRoute() {
    if (driverLat == null || driverLng == null || pickupLat == null || pickupLng == null) return;
    isRouteLoading = true;
    setVisible('routeLoading', true);
    fetchRoute(driverLat, driverLng, pickupLat, pickupLng)
      .then(function (data) {
        if (!data.routes || !data.routes[0]) {
          var km = haversineKm(driverLat, driverLng, pickupLat, pickupLng);
          setText('routeDistance', '~' + formatKm(km));
          setText('routeEta', '~' + formatEtaMin((km / 25) * 60));
          fitMap();
          isRouteLoading = false;
          setVisible('routeLoading', false);
          return;
        }
        var route = data.routes[0];
        if (routeLine && map) map.removeLayer(routeLine);
        var latLngs = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
        routeLine = L.polyline(latLngs, {
          color: '#2563eb',
          weight: 7,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
          className: 'route-line-highlight'
        }).addTo(map);
        var distKm = route.distance / 1000;
        var etaMin = route.duration / 60;
        setText('routeDistance', formatKm(distKm));
        setText('routeEta', formatEtaMin(etaMin));
        fitMap();
        isRouteLoading = false;
        setVisible('routeLoading', false);
      })
      .catch(function () {
        var km = haversineKm(driverLat, driverLng, pickupLat, pickupLng);
        setText('routeDistance', '~' + formatKm(km));
        setText('routeEta', '~' + formatEtaMin((km / 25) * 60));
        fitMap();
        isRouteLoading = false;
        setVisible('routeLoading', false);
      });
  }

  function fitMap() {
    if (!map) return;
    var bounds = [];
    if (pickupLat != null && pickupLng != null) bounds.push([pickupLat, pickupLng]);
    if (driverLat != null && driverLng != null) bounds.push([driverLat, driverLng]);
    if (bounds.length >= 2) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    }
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
      var ln = value.lng != null ? value.lng : (value.longitude != null ? value.longitude : value.lon);
      if (la != null && ln != null) {
        la = parseFloat(la);
        ln = parseFloat(ln);
        if (!isNaN(la) && !isNaN(ln)) return [la, ln];
      }
    }
    return null;
  }

  function applyTripData(data) {
    tripStatus = data.status || tripStatus;
    setStatusBanner();

    var pickup = parseCoords(data.pickup) || parseCoords(data.pickup_location) ||
      (data.pickup_lat != null && data.pickup_lng != null ? parseCoords([data.pickup_lat, data.pickup_lng]) : null);
    var driver = parseCoords(data.driver);

    driverPhone = data.driver_phone || data.driver_info && data.driver_info.phone || data.driver_info && data.driver_info.phone_number || null;
    driverName = data.driver_name || data.driver_info && data.driver_info.name || null;
    driverCarInfo = data.driver_car || data.driver_info && data.driver_info.car || data.car_info || null;

    var driverDisplay = driverName || driverCarInfo || (driverPhone ? 'Haydovchi' : '—');
    if (driverCarInfo && driverName) driverDisplay = driverName + ' · ' + driverCarInfo;
    else if (driverCarInfo) driverDisplay = driverCarInfo;
    setText('driverInfo', driverDisplay);

    if (pickup) {
      pickupLat = pickup[0];
      pickupLng = pickup[1];
      addPickupMarker(pickup[0], pickup[1]);
    }
    if (driver && (driver[0] !== 0 || driver[1] !== 0)) {
      var newDriverLat = driver[0];
      var newDriverLng = driver[1];
      var bearing = driverBearingDeg || 0;
      if (driverLat != null && driverLng != null) {
        var movedKm = haversineKm(driverLat, driverLng, newDriverLat, newDriverLng);
        if (movedKm >= 0.005) {
          bearing = calculateBearing(driverLat, driverLng, newDriverLat, newDriverLng);
        }
      }
      driverBearingDeg = bearing;
      addDriverMarker(newDriverLat, newDriverLng, bearing);
      driverLat = newDriverLat;
      driverLng = newDriverLng;
    }

    if (tripStatus === 'WAITING' || tripStatus === 'STARTED') {
      setVisible('btnCallDriver', !!driverPhone);
      setVisible('btnCancelTrip', true);
      var btnCallEl = document.getElementById('btnCallDriver');
      if (btnCallEl && driverPhone) {
        var tel = String(driverPhone).replace(/\D/g, '');
        if (tel.length >= 9) {
          if (tel.indexOf('998') !== 0 && tel.length === 9) tel = '998' + tel;
          if (tel.indexOf('998') === 0) tel = '+' + tel; else tel = '+' + tel;
        }
        btnCallEl.href = 'tel:' + tel;
      }
      if (driverLat != null && driverLng != null && pickupLat != null && pickupLng != null) drawRoute();
      else {
        if (driverLat != null && driverLng != null && pickupLat != null && pickupLng != null) {
          var km = haversineKm(driverLat, driverLng, pickupLat, pickupLng);
          setText('routeDistance', '~' + formatKm(km));
          setText('routeEta', '~' + formatEtaMin((km / 25) * 60));
        }
        fitMap();
      }
    } else {
      setVisible('btnCallDriver', false);
      setVisible('btnCancelTrip', false);
      if (tripStatus === 'FINISHED') setText('statusText', 'Safar tugadi');
      else if (tripStatus === 'CANCELLED' || tripStatus === 'CANCELLED_BY_DRIVER' || tripStatus === 'CANCELLED_BY_RIDER') setText('statusText', 'Safar bekor qilindi');
      clearRoute();
      disconnectWebSocket();
    }
  }

  function showMissingParams() {
    var el = document.getElementById('missing-params');
    if (el) el.classList.add('visible');
  }

  function run() {
    tripId = getTripId();
    if (!tripId) {
      showMissingParams();
      setText('statusText', 'trip_id topilmadi');
      return;
    }

    initMap();
    setText('statusText', 'Yuklanmoqda…');
    connectWebSocket();

    fetchTrip()
      .then(function (data) {
        applyTripData(data);
      })
      .catch(function () {
        setText('statusText', 'Reja topilmadi');
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
    var btnCall = document.getElementById('btnCallDriver');
    if (btnCall) {
      btnCall.addEventListener('click', function (e) {
        e.preventDefault();
        if (!driverPhone) return;
        var tel = String(driverPhone).replace(/\D/g, '');
        if (tel.length === 9) tel = '998' + tel;
        if (tel.length >= 9) tel = '+' + tel;
        openPhoneDialer('tel:' + tel);
      });
    }

    var btnCancel = document.getElementById('btnCancelTrip');
    if (btnCancel) {
      btnCancel.addEventListener('click', function () {
        var btn = this;
        var prevText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '…';
        cancelTrip()
          .then(function () {
            applyTripData({ status: 'CANCELLED' });
            fetchTrip().then(function (data) { applyTripData(data); }).catch(function () {});
          })
          .catch(function (err) {
            setText('statusText', 'Safarni bekor qilish muvaffaqiyatsiz. Qaytadan urinib ko\'ring.');
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
