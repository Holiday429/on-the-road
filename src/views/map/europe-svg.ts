/* ==========================================================================
   On the Road · Stylized Europe landmass
   --------------------------------------------------------------------------
   A simplified, friendly silhouette of Western/Central Europe sized to the
   1000 x 760 projection window in geo.ts. Not survey-accurate — it reads as
   "Europe" while staying clean and on-brand. Coordinates are hand-tuned so the
   plotted cities land on the right country.
   ========================================================================== */

// Single combined path of the mainland + Iberia + Italy + Scandinavia tip.
// Drawn in the same coordinate space as MAP_VIEW (x: 0..1000, y: 0..760).
export const EUROPE_PATH = `
M 470 70
C 520 55, 560 60, 575 95
C 590 120, 575 150, 600 165
C 640 150, 700 160, 715 200
C 730 235, 700 250, 690 285
C 720 300, 760 320, 760 360
C 760 400, 720 410, 705 445
C 740 470, 790 500, 800 545
C 808 585, 770 605, 740 625
C 760 660, 740 700, 700 705
C 665 709, 650 680, 620 670
C 600 700, 560 705, 540 675
C 525 650, 540 620, 520 600
C 480 605, 445 595, 435 560
C 380 575, 320 565, 300 525
C 270 535, 230 530, 215 500
C 190 460, 215 425, 195 400
C 150 410, 105 395, 100 355
C 96 320, 130 305, 140 280
C 110 265, 80 235, 95 200
C 108 170, 150 175, 175 165
C 210 150, 255 165, 285 150
C 300 120, 270 95, 295 75
C 320 58, 360 70, 385 60
C 415 50, 445 58, 470 70
Z
`.replace(/\s+/g, ' ').trim();

// A few decorative inland accents (lakes / alpine zone) for visual texture.
export const EUROPE_ACCENTS = [
  // Alpine band near Switzerland/N Italy
  'M 590 410 C 620 400, 660 405, 680 425 C 660 440, 615 440, 590 410 Z',
];
