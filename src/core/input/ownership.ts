/**
 * Which surface owns the interaction.
 *
 * The canvas is not a focusable element, so clicking it does not move the
 * keyboard focus: a text field somewhere else in the app can still hold it
 * while the pointer is over the artwork. The quick-resize gesture has to
 * know that, because taking the gesture away from a field the user is typing
 * in is exactly the kind of hijacking a drawing application must not do.
 *
 * The same question has two answers, and they are different:
 *
 *  - A modal dialog covers the canvas, so the canvas never receives the
 *    press at all. The check is still worth having, because the keyboard
 *    shortcuts reach the whole window.
 *  - A slider or a panel owns the pointer only while it is being pressed.
 *    A press that lands on the canvas belongs to the canvas.
 */

/** The parts of an element the ownership checks look at. */
export interface FocusableElementLike {
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

/**
 * True when the element takes typed text.
 *
 * A range input, a checkbox, a radio and a button do not: they take a
 * pointer or a keystroke, but not a word, so they do not make the user
 * "in the middle of typing". A number field does, so it counts as text.
 */
export function takesTextInput(element: FocusableElementLike | null | undefined): boolean {
  if (!element) {
    return false;
  }
  const tag = (element.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (element.isContentEditable === true) {
    return true;
  }
  if (tag !== "INPUT") {
    return false;
  }
  const type = (element.type ?? "text").toLowerCase();
  return type !== "range" && type !== "checkbox" && type !== "radio" && type !== "button";
}

/** True when the focused element takes typed text. */
export function focusTakesTextInput(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return takesTextInput(document.activeElement as FocusableElementLike | null);
}

/**
 * True when a modal dialog is open.
 *
 * The dialogs mark themselves with `aria-modal`, so the check does not depend
 * on a class name or on a piece of component state.
 */
export function modalIsOpen(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * True when another surface owns the interaction.
 *
 * A field the user is typing in owns the keyboard, and a modal dialog owns
 * the window. Neither may lose a gesture to the canvas.
 */
export function surfaceOwnsInteraction(): boolean {
  return focusTakesTextInput() || modalIsOpen();
}
