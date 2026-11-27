// Every tuning number and colour in one place: the flight model, the terrain, the HUD and the
// camera all read from here, so a change to the feel of the aeroplane is one edit, not six.
// Units are metres, seconds, radians and knots where the name says so.

export const VIEW = { width: 1280, height: 720 };

/** The simulation runs at a fixed 120 Hz; a slow frame runs several steps, never half of one. */
export const STEP = 1 / 120;
export const MAX_FRAME = 0.2;

/** The aeroplane: a single-engine bush plane with a constant-speed prop. Thrust is about a fifth of
 * the weight — enough to climb and to hold 90 knots, not enough to outrun the rings — and the wing
 * is big and the stall slow, so a 760 m strip and a 46 m gate are both workable. */
export const AIRCRAFT = {
  massKg: 1250,
  wingAreaM2: 25.6,
  maxThrustN: 3050,
  idleThrustN: 120,
  /** Lift coefficient at zero angle of attack, and how fast it grows with alpha. */
  cl0: 0.30,
  clAlpha: 4.4,
  /** Drag polar: Cd = cd0 + k * Cl^2, plus gear and flap increments. */
  cd0: 0.030,
  inducedK: 0.045,
  gearDrag: 0.015,
  flapDrag: 0.030,
  /** The wing stalls past this angle of attack; lift then falls away instead of growing. */
  stallAlpha: 0.28,
  /** How quickly the airframe answers a control input, per second. */
  pitchRate: 0.95,
  rollRate: 2.1,
  yawRate: 0.50,
  /** Fuel: kilograms, and the burn at full throttle in kg/s. */
  fuelKg: 96,
  burnFullKgS: 0.052,
  burnIdleKgS: 0.008,
  /** Damage 0..1: it costs thrust and adds drag, and past 0.55 the engine runs rough. */
  damageDrag: 0.09,
  damageThrust: 0.62,
  maxBankRad: 1.15,
};

export const MISSION = {
  ringCount: 6,
  ringRadiusM: 74,
  /** Seconds allowed for the whole sortie before the light goes. */
  sortieSeconds: 420,
  /** The mail drop: a marked circle on the village strip. */
  dropRadiusM: 210,
  dropMaxAglFt: 420,
  dropMaxBankDeg: 22,
  /** Landing grading bands, in metres per second of sink and metres off the centreline. */
  sinkGood: 1.6,
  sinkOk: 3.2,
  sinkHard: 5.2,
  centreGood: 6,
  centreOk: 16,
  speedGoodKt: 68,
  speedOkKt: 84,
};

export const PALETTE = {
  skyZenith: [0.113, 0.145, 0.278],
  skyMid: [0.475, 0.373, 0.475],
  skyHorizon: [0.960, 0.667, 0.451],
  skyGlow: [1.0, 0.855, 0.635],
  sun: [1.0, 0.949, 0.816],
  fog: [0.847, 0.616, 0.482],
  oceanDeep: [0.078, 0.161, 0.216],
  oceanShallow: [0.180, 0.353, 0.396],
  foam: [0.878, 0.855, 0.792],
  rockDark: [0.196, 0.184, 0.169],
  rockLight: [0.361, 0.333, 0.298],
  ash: [0.286, 0.271, 0.259],
  moss: [0.243, 0.310, 0.180],
  mossLight: [0.400, 0.451, 0.243],
  sand: [0.667, 0.576, 0.435],
  lava: [1.0, 0.373, 0.129],
  lavaHot: [1.0, 0.706, 0.290],
  ringGold: [1.0, 0.741, 0.259],
  ringInner: [1.0, 0.878, 0.545],
  runway: [0.145, 0.137, 0.129],
  runwayMark: [0.898, 0.886, 0.847],
  hullCream: [0.886, 0.847, 0.769],
  hullRed: [0.706, 0.192, 0.161],
  hullDark: [0.129, 0.129, 0.137],
  glass: [0.180, 0.290, 0.353],
  prop: [0.110, 0.110, 0.118],
  cloud: [0.949, 0.855, 0.796],
  cloudShade: [0.729, 0.616, 0.588],
};

/** HUD ink, drawn on the overlay canvas with the 2D context. */
export const HUD = {
  ink: '#eef3fa',
  dim: '#93a5bb',
  faint: 'rgba(238,243,250,0.28)',
  panel: 'rgba(9,13,20,0.52)',
  panelEdge: 'rgba(238,243,250,0.22)',
  accent: '#ffb347',
  good: '#63e08d',
  warn: '#ff5555',
  gold: '#ffc247',
  font: 'system-ui, "DejaVu Sans", "Segoe UI", Arial, sans-serif',
  mono: 'ui-monospace, "DejaVu Sans Mono", "SF Mono", Menlo, monospace',
};

export const SAVE_KEY = 'ashfall-courier.best';
