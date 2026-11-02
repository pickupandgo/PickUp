export const INTRO_DURATION_MS = 2800;
export const POSE_STARTS = [0, 650, 865, 1075, 1270, 1980] as const;

export function interval(time: number, from: number, to: number) {
  'worklet';
  return Math.max(0, Math.min(1, (time - from) / (to - from)));
}

export function smooth(t: number) {
  'worklet';
  return t * t * (3 - 2 * t);
}

export function poseOpacity(time: number, index: number) {
  'worklet';
  const start = POSE_STARTS[index];
  const next = POSE_STARTS[index + 1];
  const enter = index === 0 ? 1 : interval(time, start - 65, start + 35);
  const exit =
    next === undefined ? 1 : 1 - interval(time, next - 65, next + 35);
  return Math.min(enter, exit);
}

// A single UI-thread clock coordinates character cels and physical movement.
export function sceneAt(time: number) {
  'worklet';
  const entry = interval(time, 0, 620);
  const drive = smooth(interval(time, 1300, 1920));
  const delivery = smooth(interval(time, 1980, 2320));
  const moving = time < 620 || (time > 1300 && time < 1920);
  return {
    bikeX: -390 + 340 * (1 - Math.pow(1 - entry, 3)) + 38 * drive,
    bikeY: moving ? Math.sin(time / 65) * 1.25 : 0,
    lean: time > 1300 && time < 1920 ? -1.4 * Math.sin(drive * Math.PI) : 0,
    wheelAngle: 420 * entry + 640 * drive,
    roadX: -(185 * entry + 300 * drive) % 76,
    destination: smooth(interval(time, 1550, 1970)),
    delivery,
    parcelX: 60 + 264 * delivery,
    parcelY: 250 + 117 * delivery - 95 * Math.sin(delivery * Math.PI),
    parcelScale: 1 - 0.3 * delivery,
    parcelOpacity: interval(time, 1915, 2015),
    completion: smooth(interval(time, 2280, 2470)),
    brand: smooth(interval(time, 2130, 2520)),
    initialBrand: 1 - interval(time, 0, 190),
  };
}

export function stageSize(width: number, height: number) {
  const scale = Math.max(
    0.45,
    Math.min((width - 24) / 390, (height - 80) / 460, 1.42),
  );
  return { scale, width: 390, height: 460 };
}

