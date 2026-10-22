/**
 * Brush dynamics: how a stroke's speed and length shape the mark.
 *
 * The brush already reacts to pressure (`pressureSize`, `pressureOpacity` and
 * the pressure curve). Dynamics are the other two classic axes - **speed** and
 * **taper** - and they are a separate layer so that turning them on cannot
 * change a stroke that does not use them.
 *
 * The default model is inert: every factor is `1`, so a stroke drawn with no
 * dynamics is byte for byte the stroke that was drawn before this module
 * existed. That is the rule the whole wave follows - a new capability must be
 * invisible until it is asked for.
 *
 * The model is pure. It maps a context - the current speed and how far along
 * the stroke the sample is - to a size factor. It never reads the document
 * and never writes to it.
 */

/** The closed set of dynamics a stroke can use. */
export type DynamicsModel = {
  /** Stable id, unique across the registry. */
  readonly id: string;
  /** The name the controls show. */
  readonly label: string;
  /**
   * The speed that counts as fully fast, in document pixels per second.
   *
   * A speed of `0` means the velocity source is off, whatever
   * `velocitySize` says.
   */
  readonly velocityReference: number;
  /**
   * How much a fully fast stroke narrows, in `[0, 1]`.
   *
   * `0` keeps the size constant whatever the speed.
   */
  readonly velocitySize: number;
  /**
   * The fraction of the stroke's length used to ramp the size up at the start,
   * in `[0, 1]`.
   */
  readonly taperIn: number;
  /**
   * The fraction of the stroke's length used to ramp the size down at the end,
   * in `[0, 1]`.
   */
  readonly taperOut: number;
  /**
   * How far the taper narrows the tip, in `[0, 1]`.
   *
   * `1` is a point; `0` is no taper at all.
   */
  readonly taperDepth: number;
};

/** The dynamics a brush uses when nothing else is chosen: no change at all. */
export const DEFAULT_DYNAMICS_MODEL: DynamicsModel = Object.freeze({
  id: "none",
  label: "None",
  velocityReference: 0,
  velocitySize: 0,
  taperIn: 0,
  taperOut: 0,
  taperDepth: 0,
});

/** The lowest and highest speed the model accepts, in document px/s. */
export const MIN_VELOCITY_REFERENCE = 1;
export const MAX_VELOCITY_REFERENCE = 10000;

/** What the model is asked about. */
export interface DynamicsContext {
  /**
   * The sample's speed, in document pixels per second.
   *
   * A negative or non-finite speed is read as `0`.
   */
  readonly speed: number;
  /**
   * How far along the stroke the sample is, in `[0, 1]`.
   *
   * `0` is the first sample and `1` is the last. A value outside the range is
   * clamped, so a stroke whose length is not yet known still behaves.
   */
  readonly progress: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value > 1 ? 1 : value;
}

/**
 * Reads a dynamics model out of an untrusted value.
 *
 * Every field is clamped rather than rejected, so a hand-edited file still
 * yields a usable model.
 */
export function normalizeDynamicsModel(value: unknown): DynamicsModel {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_DYNAMICS_MODEL;
  }
  const record = value as Partial<DynamicsModel>;
  const id = typeof record.id === "string" && record.id.trim() !== "" ? record.id : "none";
  const label = typeof record.label === "string" ? record.label : id;
  const velocityReference = clampNumber(
    record.velocityReference,
    DEFAULT_DYNAMICS_MODEL.velocityReference,
    MIN_VELOCITY_REFERENCE,
    MAX_VELOCITY_REFERENCE,
  );
  return {
    id,
    label,
    velocityReference,
    velocitySize: clampNumber(record.velocitySize, 0, 0, 1),
    taperIn: clampNumber(record.taperIn, 0, 0, 1),
    taperOut: clampNumber(record.taperOut, 0, 0, 1),
    taperDepth: clampNumber(record.taperDepth, 0, 0, 1),
  };
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  return value > max ? max : value;
}

/** The smooth 3t² - 2t³ ramp, so a taper starts and ends without a kink. */
function smoothstep(t: number): number {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * The factor the velocity source applies to the size.
 *
 * A fast stroke is narrower: the factor falls from `1` at rest to
 * `1 - velocitySize` at the reference speed and stays there.
 */
export function velocitySizeFactor(
  model: DynamicsModel,
  speed: number,
): number {
  if (model.velocitySize <= 0 || model.velocityReference <= 0) {
    return 1;
  }
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const ratio = clamp01(safeSpeed / model.velocityReference);
  return 1 - model.velocitySize * ratio;
}

/**
 * The factor the taper applies to the size.
 *
 * The stroke is thinnest at its two ends and at its thickest in the middle.
 * The two ramps are independent, so a stroke may taper in only, out only, or
 * both.
 */
export function taperSizeFactor(model: DynamicsModel, progress: number): number {
  if (model.taperDepth <= 0) {
    return 1;
  }
  const at = clamp01(progress);
  let factor = 1;
  if (model.taperIn > 0) {
    const ramp = smoothstep(at / model.taperIn);
    factor = Math.min(factor, 1 - model.taperDepth * (1 - ramp));
  }
  if (model.taperOut > 0) {
    const remaining = 1 - at;
    const ramp = smoothstep(remaining / model.taperOut);
    factor = Math.min(factor, 1 - model.taperDepth * (1 - ramp));
  }
  return factor;
}

/**
 * The factor the whole model applies to the size.
 *
 * The two sources multiply: a fast stroke that is also tapering in is
 * narrower for both reasons.
 */
export function dynamicsSizeFactor(
  model: DynamicsModel,
  context: DynamicsContext,
): number {
  return velocitySizeFactor(model, context.speed) * taperSizeFactor(model, context.progress);
}

/** Whether a model changes anything at all. */
export function dynamicsAreInert(model: DynamicsModel): boolean {
  return (
    model.velocitySize <= 0 &&
    model.taperDepth <= 0 &&
    model.taperIn <= 0 &&
    model.taperOut <= 0
  );
}

const models = new Map<string, DynamicsModel>();

/** Adds a model, or replaces the one already registered under the same id. */
export function registerDynamicsModel(model: DynamicsModel): DynamicsModel {
  if (model.id.trim() === "") {
    throw new Error("a dynamics model needs a non-empty id");
  }
  models.set(model.id, model);
  return model;
}

/** Removes a model. Returns whether one was there. */
export function unregisterDynamicsModel(id: string): boolean {
  return models.delete(id);
}

/** Every registered model, in registration order. */
export function listDynamicsModels(): readonly DynamicsModel[] {
  return [...models.values()];
}

/** One model by id, or `undefined`. */
export function findDynamicsModel(id: string): DynamicsModel | undefined {
  return models.get(id);
}

/**
 * Empties the registry.
 *
 * Only for tests: the built-in models register themselves when their module
 * is evaluated.
 */
export function resetDynamicsModels(): void {
  models.clear();
}

registerDynamicsModel(DEFAULT_DYNAMICS_MODEL);
