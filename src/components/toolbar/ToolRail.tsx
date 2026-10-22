/**
 * The left tool rail: one button per registered tool.
 *
 * The tools are grouped the way they are used - mark, select, shape, fill,
 * look - with a hairline between the groups, so the rail reads as a handful
 * of families instead of one long list. The order is the tool registry's, so
 * the keyboard shortcuts and the rail never disagree.
 */

import { Fragment } from "react";
import { TOOL_DEFINITIONS } from "../../core/tools/toolDefinitions";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import type { ToolId } from "../../types/tool";
import { IconButton } from "./IconButton";
import { TOOL_ICONS } from "./toolIcons";

/** The families the rail is grouped into, in the registry's own order. */
const TOOL_GROUPS: readonly (readonly ToolId[])[] = [
  ["brush", "eraser"],
  ["select"],
  ["line", "rectangle", "ellipse", "polygon", "star"],
  ["bucket", "gradient"],
  ["picker", "guides", "pan"],
];

export function ToolRail() {
  const { actions } = useEditor();
  const { toolId } = useEditorState();

  return (
    <nav className="tool-rail" aria-label="Tools">
      {TOOL_GROUPS.map((group, groupIndex) => (
        <Fragment key={group.join("-")}>
          {groupIndex > 0 ? (
            <span className="tool-rail__separator" aria-hidden="true" />
          ) : null}
          <div className="tool-rail__group">
            {group.map((id) => {
              const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === id);
              if (!tool) {
                return null;
              }
              return (
                <IconButton
                  key={tool.id}
                  label={tool.label}
                  shortcut={tool.shortcut}
                  active={tool.id === toolId}
                  tooltipPlacement="right"
                  onClick={() => actions.setTool(tool.id)}
                >
                  {TOOL_ICONS[tool.id]}
                </IconButton>
              );
            })}
          </div>
        </Fragment>
      ))}
    </nav>
  );
}
