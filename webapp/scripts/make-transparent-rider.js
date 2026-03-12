/**
 * Makes black/dark pixels in rider-pin.png transparent.
 * Run from webapp folder: node scripts/make-transparent-rider.js
 */
const path = require('path');
const sharp = require('sharp');

const inputPath = path.join(__dirname, '../images/rider-pin.png');
const outputPath = path.join(__dirname, '../images/rider-pin-transparent.png');

const THRESHOLD = 45;

sharp(inputPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
  .then(({ data, info }) => {
    const { width, height, channels } = info;
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r <= THRESHOLD && g <= THRESHOLD && b <= THRESHOLD) {
        data[i + 3] = 0;
      }
    }
    return sharp(data, { raw: { width, height, channels } })
      .png()
      .toFile(outputPath);
  })
  .then(() => console.log('Done: transparent rider icon saved to', outputPath))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

