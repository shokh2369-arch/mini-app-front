/**
 * Serves the webapp and checks password from .env.
 * Run: node server.js   (from webapp folder, with .env containing PASSWORD=...)
 */
const path = require('path');
const fs = require('fs');

// Load .env from current directory
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const PASSWORD = process.env.PASSWORD || '';

app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/verify-password', function (req, res) {
  const submitted = req.body && req.body.password;
  if (!PASSWORD) {
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }
  if (submitted === PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false });
});

app.listen(PORT, function () {
  console.log('App at http://localhost:' + PORT);
  console.log('Password gate: PASSWORD from .env');
});
