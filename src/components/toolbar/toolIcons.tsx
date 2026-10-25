/**
 * The icon of each tool, shared by the tool rail and the options bar.
 *
 * The icons live apart from the icon set so that a tool's icon is written
 * once: the rail, the flyout and the options bar all draw the same glyph for
 * the same tool, and a tool that gains an icon cannot end up with two.
 *
 * The glyph for a collapsed group is drawn here too. It belongs to the rail's
 * own vocabulary - it says "a family of shapes", not "the rectangle tool" -
 * and the shared icon set is not this file's to change.
 */

import type { ReactNode, SVGProps } from "react";
import type { ToolGroupId } from "../../core/tools/toolRail";
import type { ToolId } from "../../types/tool";
import {
  IconBrush,
  IconBucket,
  IconEllipse,
  IconEraser,
  IconGradient,
  IconGuides,
  IconHand,
  IconImage,
  IconLine,
  IconPicker,
  IconPolygon,
  IconRectangle,
  IconSelect,
  IconStar,
} from "../icons";

type IconProps = SVGProps<SVGSVGElement>;

/**
 * The family glyph: a square, a circle and a triangle.
 *
 * It stands for the shape family as a whole, so the rail's collapsed slot
 * says "there are shapes here" rather than naming one of them.
 */
export function IconShapes(props: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M2.5 2.5h5.5v5.5H2.5z" />
      <path d="M14 5.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
      <path d="M3 13.5 5.5 9.5 8 13.5z" />
    </svg>
  );
}

/**
 * The shape-editor glyph: a rectangle with its four corner handles.
 *
 * It has to read as "the same object as a shape, but editable", so it borrows
 * the shape family's square and adds the handles rather than repeating the
 * marquee's arrow.
 */
export function IconShapeEdit(props: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M3.5 3.5h9v9h-9z" />
      <path d="M1.5 1.5h3v3h-3zM11.5 1.5h3v3h-3zM1.5 11.5h3v3h-3zM11.5 11.5h3v3h-3z" />
    </svg>
  );
}

/** The icon of every tool. */
export const TOOL_ICONS: Record<ToolId, ReactNode> = {
  brush: <IconBrush />,
  eraser: <IconEraser />,
  select: <IconSelect />,
  shapeEdit: <IconShapeEdit />,
  line: <IconLine />,
  rectangle: <IconRectangle />,
  ellipse: <IconEllipse />,
  polygon: <IconPolygon />,
  star: <IconStar />,
  bucket: <IconBucket />,
  gradient: <IconGradient />,
  picker: <IconPicker />,
  guides: <IconGuides />,
  reference: <IconImage />,
  pan: <IconHand />,
};

/** The icon of a group that stands for a family rather than for one tool. */
const GROUP_ICONS: Partial<Record<ToolGroupId, ReactNode>> = {
  shape: <IconShapes />,
};

/** The icon of a tool. */
export function toolIcon(toolId: ToolId): ReactNode {
  return TOOL_ICONS[toolId];
}

/** The icon of a group, when the group has one of its own. */
export function toolGroupIcon(groupId: ToolGroupId): ReactNode | null {
  return GROUP_ICONS[groupId] ?? null;
}
