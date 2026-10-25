/**
 * The left tool rail.
 *
 * The rail arranges the registered tools into named groups - draw, shapes,
 * fill, select, colour, navigate, assist - and shows which tool is active.
 *
 * Every button selects a real tool. The shape family shares one slot that
 * opens a flyout of the five shape tools, because a family that shares one
 * gesture does not need five rows of rail; the common tools stay on the rail
 * itself. The pan tool is temporary navigation: clicking it while it is
 * already active returns to the tool the artist came from, so the app never
 * strands them in a mode that cannot paint.
 *
 * The tooltips are the rail's own rather than the browser's: they are
 * anchored to their button instead of following the pointer, so they never
 * sit under the cursor or over the canvas the artist is aiming at.
 *
 * The rules - which slots the rail shows, what a click does and what a
 * tooltip says - live in `core/tools/toolRail.ts`, so they are unit tested
 * without a browser. This file only draws them.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import {
  railToolTarget,
  rememberTool,
  toolRailSlotGroups,
  toolRailSlots,
  toolRailTooltip,
  type ToolGroupId,
  type ToolRailSlot,
  type ToolRailTooltipContent,
} from "../../core/tools/toolRail";
import { useEditor, useEditorToolId } from "../../hooks/useEditor";
import type { ToolId } from "../../types/tool";
import { IconChevronDown } from "../icons";
import { ToolRailButton } from "./ToolRailButton";
import { ToolRailMenu } from "./ToolRailMenu";
import { ToolRailTooltip } from "./ToolRailTooltip";
import { TOOL_ICONS, toolGroupIcon } from "./toolIcons";

/** How long the pointer has to rest on a tool before its tooltip appears. */
const TOOLTIP_DELAY_MS = 350;

interface TooltipState extends ToolRailTooltipContent {
  readonly anchor: DOMRect;
}

export function ToolRail() {
  const { actions } = useEditor();
  const toolId = useEditorToolId();
  const slots = useMemo(() => toolRailSlots(toolId), [toolId]);
  const groups = useMemo(() => toolRailSlotGroups(slots), [slots]);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [openGroup, setOpenGroup] = useState<{ id: ToolGroupId; anchor: DOMRect } | null>(null);

  const railRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rememberedRef = useRef<ToolId | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);

  const hideTooltip = useCallback(() => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltip(null);
  }, []);

  const showTooltip = useCallback(
    (element: HTMLElement, content: ToolRailTooltipContent) => {
      if (tooltipTimerRef.current !== null) {
        window.clearTimeout(tooltipTimerRef.current);
      }
      tooltipTimerRef.current = window.setTimeout(() => {
        tooltipTimerRef.current = null;
        setTooltip({ ...content, anchor: element.getBoundingClientRect() });
      }, TOOLTIP_DELAY_MS);
    },
    [],
  );

  // The pan tool is temporary, so the rail remembers where it came from. The
  // memory follows every tool change, including the ones a shortcut makes.
  // A tool change also closes the flyout: it armed a tool the flyout no
  // longer shows.
  useEffect(() => {
    rememberedRef.current = rememberTool(rememberedRef.current, toolId);
    setOpenGroup(null);
    hideTooltip();
  }, [toolId, hideTooltip]);

  // A tooltip that outlives its button - after a scroll or a resize - would
  // point at nothing.
  useEffect(() => {
    const handle = () => hideTooltip();
    window.addEventListener("resize", handle);
    window.addEventListener("scroll", handle, true);
    return () => {
      window.removeEventListener("resize", handle);
      window.removeEventListener("scroll", handle, true);
    };
  }, [hideTooltip]);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpenGroup(null);
    if (restoreFocus) {
      menuTriggerRef.current?.focus();
    }
  }, []);

  /** Selects a tool, applying the rail's rules for the temporary pan tool. */
  const selectTool = useCallback(
    (requestedToolId: ToolId) => {
      setOpenGroup(null);
      actions.setTool(railToolTarget(toolId, requestedToolId, rememberedRef.current));
    },
    [actions, toolId],
  );

  const handleMenuSelect = useCallback(
    (selectedToolId: ToolId) => {
      setOpenGroup(null);
      actions.setTool(selectedToolId);
      menuTriggerRef.current?.focus();
    },
    [actions],
  );

  /**
   * The arrow keys walk the rail, as a toolbar does. They stop the event, so
   * the arrow keys cannot nudge a selection at the same time.
   */
  const handleRailKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      railRef.current?.querySelectorAll<HTMLButtonElement>("button[data-rail-item]") ?? [],
    );
    if (items.length === 0) {
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLButtonElement);

    const move = (next: number) => {
      event.preventDefault();
      event.stopPropagation();
      items[(next + items.length) % items.length]?.focus();
    };

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        move(index + 1);
        return;
      case "ArrowUp":
      case "ArrowLeft":
        move(index - 1);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(items.length - 1);
        return;
      default:
        return;
    }
  }, []);

  const renderSlot = (slot: ToolRailSlot) => {
    const content = toolRailTooltip(slot, toolId, rememberedRef.current);

    if (slot.isMenu) {
      const group = slot.group;
      const isOpen = openGroup?.id === group.id;
      const armedTool = group.toolIds.includes(toolId) ? getToolDefinition(toolId) : null;
      const groupIcon = toolGroupIcon(group.id);
      return (
        <ToolRailButton
          key={group.id}
          label={armedTool ? `${group.label}, ${armedTool.label} active` : group.label}
          description={group.description}
          active={slot.isActive}
          current={slot.isActive}
          hasPopup
          expanded={isOpen}
          tabIndex={slot.isActive ? 0 : -1}
          buttonRef={menuTriggerRef}
          onClick={(event) => {
            if (isOpen) {
              closeMenu(true);
              return;
            }
            setOpenGroup({ id: group.id, anchor: event.currentTarget.getBoundingClientRect() });
          }}
          onPointerEnter={(event) => showTooltip(event.currentTarget, content)}
          onPointerLeave={hideTooltip}
          onPointerDown={hideTooltip}
        >
          <span className="tool-rail__slot-icon">
            {armedTool ? TOOL_ICONS[toolId] : (groupIcon ?? TOOL_ICONS[slot.toolId])}
          </span>
          <span className="tool-rail__slot-caret" aria-hidden="true">
            <IconChevronDown width="9" height="9" />
          </span>
        </ToolRailButton>
      );
    }

    const tool = getToolDefinition(slot.toolId);
    return (
      <ToolRailButton
        key={tool.id}
        label={tool.label}
        description={tool.description}
        shortcut={content.shortcut}
        active={slot.isActive}
        tabIndex={slot.isActive ? 0 : -1}
        onClick={() => selectTool(tool.id)}
        onPointerEnter={(event) => showTooltip(event.currentTarget, content)}
        onPointerLeave={hideTooltip}
        onPointerDown={hideTooltip}
      >
        {TOOL_ICONS[tool.id]}
      </ToolRailButton>
    );
  };

  const openGroupDefinition = openGroup
    ? (slots.find((slot) => slot.group.id === openGroup.id)?.group ?? null)
    : null;

  return (
    <div
      className="tool-rail"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Tools"
      ref={railRef}
      onKeyDown={handleRailKeyDown}
    >
      {groups.map((groupSlotsForGroup, index) => {
        const group = groupSlotsForGroup[0].group;
        return (
          <Fragment key={group.id}>
            {index > 0 ? <div className="tool-rail__divider" aria-hidden="true" /> : null}
            <div className="tool-rail__group" role="group" aria-label={group.label}>
              {groupSlotsForGroup.map(renderSlot)}
            </div>
          </Fragment>
        );
      })}

      {tooltip ? (
        <ToolRailTooltip
          title={tooltip.title}
          description={tooltip.description}
          shortcut={tooltip.shortcut}
          hint={tooltip.hint}
          anchor={tooltip.anchor}
        />
      ) : null}

      {openGroup && openGroupDefinition ? (
        <ToolRailMenu
          group={openGroupDefinition}
          activeToolId={toolId}
          anchor={openGroup.anchor}
          anchorElement={menuTriggerRef.current}
          onSelect={handleMenuSelect}
          onClose={() => closeMenu(true)}
        />
      ) : null}
    </div>
  );
}
