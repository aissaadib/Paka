/**
 * The modes a selection gesture can be in.
 *
 * The select tool does four different things with the same pointer: it rubber
 * bands a marquee, it translates the selected strokes, it scales them and it
 * turns them. They look like one tool, but they are four **modes**, and the
 * mode a press starts in is decided by rules rather than by the order the code
 * happens to check things in. This module is those rules, and nothing else: it
 * is pure, DOM-free and testable without a canvas or a pointer.
 *
 * Three rules decide the mode, in this order:
 *
 *  - **A press on a handle starts that handle's mode.** The handles are the
 *    transform's affordance: a corner scales, the handle above the frame
 *    rotates. They sit on the frame's corners, which are *inside* the frame,
 *    so a handle press would otherwise start a move. Grabbing a handle is an
 *    explicit "transform this", and it wins.
 *  - **A press inside the selection moves it.** Dragging inside the frame
 *    translates the selected strokes.
 *  - **A press anywhere else starts a marquee.** A drag rubber-bands a new
 *    selection; a press that never moved is a zero-size marquee, which is a
 *    click, and a click selects the strokes under the pointer.
 *
 * The mode also fixes **the geometry the gesture is measured against**:
 *
 *  - a marquee is the rectangle between the press and the pointer;
 *  - a move is the delta between the press and the pointer;
 *  - a scale is a factor about the centre of the frame, measured **from the
 *    press**, and clamped so it can never collapse or invert the selection;
 *  - a rotation is an angle about the same centre, measured **from the
 *    press**, snapped to 15 degrees unless Shift turns the snap off.
 *
 * The geometry is not forked here. The module reuses `selectionTransform.ts`
 * and `selectionHandles.ts`, which already own the frame, the centre, the
 * factor, the clamp and the snap; this module says only *which* of them a mode
 * uses and *when*.
 *
 * Two invariants the rest of the feature leans on:
 *
 *  - **A transform is baked on apply.** It moves the selected strokes' samples
 *    and nothing else: the brush, the colour, the opacity, the texture and the
 *    pressure are untouched, so a scaled stroke is still an ordinary stroke and
 *    the project format does not change.
 *  - **One gesture, one history step.** A scale or a rotation is recorded
 *    exactly like a move - one entry on the undo stack for the whole drag -
 *    because a mode's geometry is *one* coordinate map, not a series of edits.
 */

import type { Bounds, Point } from "../../types/geometry";
import type { SelectionHandleId } from "./selectionHandles";
import { boundsFromCorners } from "./strokeSelection";
import {
  clampScaleFactor,
  createRotateTransform,
  createScaleTransform,
  rotationAngleFrom,
  scaleFactorFrom,
  snapRotationAngle,
  type SampleTransform,
} from "./selectionTransform";

/**
 * The modes a selection gesture can be in.
 *
 * The set is closed: a gesture is in exactly one of them, and nothing outside
 * the set is a mode. The engine's gesture state uses the same four names, so
 * a mode reads the same in the tool, in the engine and in the history.
 */
export type SelectionMode = "marquee" | "move" | "scale" | "rotate";

/** The closed set of modes. */
export const SELECTION_MODES: readonly SelectionMode[] = ["marquee", "move", "scale", "rotate"];

/** True when the value is one of the modes. */
export function isSelectionMode(value: unknown): value is SelectionMode {
  return typeof value === "string" && (SELECTION_MODES as readonly string[]).includes(value);
}

/**
 * The mode a handle's drag is in.
 *
 * A handle is always a transform handle, so the mode is never a marquee or a
 * move: the four corners scale and the handle above the frame rotates.
 */
export function modeForHandle(handle: SelectionHandleId): "scale" | "rotate" {
  return handle === "rotate" ? "rotate" : "scale";
}

/**
 * What a press found.
 *
 * The two questions are the whole of the mode decision: did the press grab a
 * handle, and did it land inside the current selection? Everything else about
 * the press - the button, the modifiers - is the tool's business, not the
 * mode's.
 */
export interface SelectionPress {
  /** The handle the press grabbed, or `null` when it grabbed none. */
  readonly handle: SelectionHandleId | null;
  /** True when the press landed inside the current selection's frame. */
  readonly insideSelection: boolean;
}

/**
 * The mode a press resolves to.
 *
 * A transform mode carries the handle it came from: the corner a scale pulls
 * and the ray a rotation turns on are properties of the handle, and the
 * gesture is measured against them.
 */
export type ResolvedSelectionMode =
  | { readonly mode: "marquee" }
  | { readonly mode: "move" }
  | { readonly mode: "scale"; readonly handle: SelectionHandleId }
  | { readonly mode: "rotate"; readonly handle: SelectionHandleId };

/** True when the press starts a transform: it grabbed a handle. */
export function startsHandleMode(press: SelectionPress): boolean {
  return press.handle !== null;
}

/**
 * True when the press starts a marquee.
 *
 * A marquee needs neither a handle nor a selection: a press on empty canvas
 * rubber-bands a new selection, and a press that never moved is a zero-size
 * marquee - a click, which selects the strokes under the pointer.
 */
export function startsMarquee(press: SelectionPress): boolean {
  return press.handle === null && !press.insideSelection;
}

/**
 * The mode a press starts in.
 *
 * The handles come first: they sit on the frame's corners, which are inside
 * the frame, so a press on a corner would otherwise start a move. Grabbing a
 * handle is an explicit "transform this", and it wins.
 */
export function resolveSelectionMode(press: SelectionPress): ResolvedSelectionMode {
  if (press.handle !== null) {
    switch (modeForHandle(press.handle)) {
      case "rotate":
        return { mode: "rotate", handle: press.handle };
      case "scale":
        return { mode: "scale", handle: press.handle };
    }
  }
  if (press.insideSelection) {
    return { mode: "move" };
  }
  return { mode: "marquee" };
}

/**
 * The fixed geometry a scale gesture is measured against.
 *
 * The centre is the centre of the selection's frame and the corner is the one
 * the press grabbed. Both are taken when the gesture starts and neither moves
 * while it runs, so the content cannot drift under the pointer.
 */
export interface ScaleGestureAnchor {
  /** The centre of the frame the scale is about. */
  readonly centre: Point;
  /** The corner the press grabbed. */
  readonly corner: Point;
  /** Where the press landed, which is where the drag is measured from. */
  readonly press: Point;
}

/**
 * The fixed geometry a rotation gesture is measured against.
 *
 * The centre is the centre of the selection's frame; the press is where the
 * turn is measured from.
 */
export interface RotateGestureAnchor {
  /** The centre of the frame the rotation is about. */
  readonly centre: Point;
  /** Where the press landed, which is where the turn is measured from. */
  readonly press: Point;
}

/**
 * An in-flight selection gesture: the mode it is in and the geometry it is
 * measured against.
 */
export type SelectionGesture =
  | { readonly mode: "marquee"; readonly anchor: Point }
  | { readonly mode: "move"; readonly anchor: Point }
  | { readonly mode: "scale"; readonly anchor: ScaleGestureAnchor }
  | { readonly mode: "rotate"; readonly anchor: RotateGestureAnchor };

/**
 * The live geometry of a gesture, per mode.
 *
 * A marquee and a move carry the numbers the gesture draws with. A scale and
 * a rotation carry **one** coordinate map - the transform that is baked over
 * the selected strokes' samples - and one map is one edit and therefore one
 * history step, exactly like a move.
 */
export type SelectionGestureGeometry =
  | { readonly mode: "marquee"; readonly bounds: Bounds }
  | { readonly mode: "move"; readonly dx: number; readonly dy: number }
  | { readonly mode: "scale"; readonly factor: number; readonly transform: SampleTransform }
  | { readonly mode: "rotate"; readonly angle: number; readonly transform: SampleTransform };

/**
 * The rubber band between the press and the pointer.
 *
 * The rectangle is the same one the selection is made from, so what the user
 * sees while dragging is exactly what the release selects.
 */
export function marqueeGeometry(anchor: Point, pointer: Point): SelectionGestureGeometry {
  return { mode: "marquee", bounds: boundsFromCorners(anchor, pointer) };
}

/**
 * The translation between the press and the pointer.
 *
 * The delta is zero at the press, so a click inside the selection moves
 * nothing and records nothing.
 */
export function moveGeometry(anchor: Point, pointer: Point): SelectionGestureGeometry {
  return { mode: "move", dx: pointer.x - anchor.x, dy: pointer.y - anchor.y };
}

/**
 * The scale the pointer asks for, and the map that applies it.
 *
 * The factor is measured **from the press**: the pointer may be up to a grab
 * radius off the handle, and an absolute reading would jump the content at the
 * press. It is clamped, so a drag through the centre cannot collapse the
 * selection or mirror it - a mirror is a flip, not a scale.
 */
export function scaleGeometry(
  anchor: ScaleGestureAnchor,
  pointer: Point,
): SelectionGestureGeometry {
  const factor = clampScaleFactor(
    scaleFactorFrom(anchor.centre, anchor.corner, anchor.press, pointer),
  );
  return { mode: "scale", factor, transform: createScaleTransform(anchor.centre, factor) };
}

/**
 * The rotation the pointer asks for, and the map that applies it.
 *
 * The turn is measured **from the press**, for the same reason as the scale.
 * It **snaps to 15 degrees** while the pointer is held down, and `snap: false`
 * - which is what Shift asks for - turns the snap off and keeps the free
 * angle.
 *
 * The snap's tie - exactly 7.5 degrees between two steps - breaks **away from
 * zero** in both directions: +7.5 degrees snaps to +15 and -7.5 to -15, so a
 * clockwise turn and its counter-clockwise twin land on mirror angles. The
 * rule itself lives in `snapRotationAngle`, which this module reuses rather
 * than repeats.
 */
export function rotateGeometry(
  anchor: RotateGestureAnchor,
  pointer: Point,
  options?: { readonly snap?: boolean },
): SelectionGestureGeometry {
  const turn = rotationAngleFrom(anchor.centre, anchor.press, pointer);
  const angle = options?.snap === false ? turn : snapRotationAngle(turn);
  return { mode: "rotate", angle, transform: createRotateTransform(anchor.centre, angle) };
}

/**
 * The live geometry of a gesture, for whichever mode it is in.
 *
 * This is the model's single entry point for the geometry: the engine asks for
 * the geometry of the gesture it is running, and gets the numbers or the map
 * that mode uses.
 */
export function selectionGeometry(
  gesture: SelectionGesture,
  pointer: Point,
  options?: { readonly snap?: boolean },
): SelectionGestureGeometry {
  switch (gesture.mode) {
    case "marquee":
      return marqueeGeometry(gesture.anchor, pointer);
    case "move":
      return moveGeometry(gesture.anchor, pointer);
    case "scale":
      return scaleGeometry(gesture.anchor, pointer);
    case "rotate":
      return rotateGeometry(gesture.anchor, pointer, options);
  }
}
