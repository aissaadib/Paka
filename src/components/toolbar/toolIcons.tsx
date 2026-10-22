/**
 * The icon each tool draws.
 *
 * One map, shared by the tool rail and by the options bar's tool badge, so
 * the two never disagree about what the brush looks like.
 */

import type { ReactNode } from "react";
import type { ToolId } from "../../types/tool";
import {
  IconBrush,
  IconBucket,
  IconEllipse,
  IconEraser,
  IconGradient,
  IconGuides,
  IconHand,
  IconLine,
  IconPicker,
  IconPolygon,
  IconRectangle,
  IconSelect,
  IconStar,
} from "../icons";

export const TOOL_ICONS: Record<ToolId, ReactNode> = {
  brush: <IconBrush />,
  eraser: <IconEraser />,
  select: <IconSelect />,
  line: <IconLine />,
  rectangle: <IconRectangle />,
  ellipse: <IconEllipse />,
  polygon: <IconPolygon />,
  star: <IconStar />,
  bucket: <IconBucket />,
  gradient: <IconGradient />,
  picker: <IconPicker />,
  guides: <IconGuides />,
  pan: <IconHand />,
};
