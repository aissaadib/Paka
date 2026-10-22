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
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getToolDefinition } from "../../core/tools/toolDefinitions";
import {
  panReturnToolName,
  railToolTarget,
  rememberTool,
  toolRailSlots,
  type ToolRailSlot,
} from "../../core/tools/toolRail";
import { useEditor, useEditorToolId } from "../../hooks/useEditor";
import type { ToolId } from "../../types/tool";
import { IconChevronDown, IconShapes } from "../icons";
import { ToolRailButton } from "./ToolRailButton";
import { ToolRailMenu } from "./ToolRailMenu";
import { ToolRailTooltip } from "./ToolRailTooltip";
import { TOOL_ICONS } from "./toolIcons";

/** How long the pointer has to rest on a tool before its tooltip appears. */
const TOOLTIP_DELAY_MS = 350;

interface TooltipContent {
  readonly title: string;
  readonly description?: string;
  readonly shortcut?: string;
  readonly hint?: string;
}

interface TooltipState extends TooltipContent {
  readonly anchor: DOMRect;
}

/**
 * What a slot's tooltip says.
 *
 * A collapsed slot names the family and points at the tool that is armed; a
 * plain slot names its tool. The pan slot adds the way back, because that is
 * the one button whose second click means something else.
 */
function slotTooltip(
  slot: ToolRailSlot,
  activeToolId: ToolId,
  rememberedToolId: ToolId | null,
): TooltipContent {
  if (slot.isMenu) {
    const holdsActiveTool = slot.group.toolIds.includes(activeToolId);
    const activeTool = holdsActiveTool ? getToolDefinition(activeToolId) : null;
    return {
      title: slot.group.label,
      description: `${slot.group.description} - click to choose`,
      shortcut: activeTool?.shortcut,
      hint: activeTool ? `${activeTool.label} is active` : undefined,
    };
  }

  const tool = getToolDefinition(slot.toolId);
  const isPanReturning = slot.toolId === "pan" && activeToolId === "pan";
  const returnName = panReturnToolName(rememberedToolId);
  return {
    title: tool.label,
    description: tool.description,
    shortcut: tool.shortcut,
    hint:
      slot.group.hint ??
      (isPanReturning
        ? `Click again to return to ${returnName ?? getToolDefinition("brush").label}`
        : undefined),
  };
}

export function ToolRail() {
  const { actions } = useEditor();
  const toolId = useEditorToolId();
  const slots = useMemo(() => toolRailSlots(toolId), [toolId]);
  const groups = useMemo(() => {
    const grouped: ToolRailSlot[][] = [];
    for (const slot of slots) {
      const last = grouped[grouped.length - 1];
      if (last && last[0].group.id === slot.group.id) {
        last.push(slot);
        continue;
      }
      grouped.push([slot]);
    }
    return grouped;
  }, [slots]);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [openGroup, setOpenGroup] = useState<{ id: string; anchor: HTMLElement } | null>(null);

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

  const showTooltip = useCallback((element: HTMLElement, content: TooltipContent) => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current);
    }
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null;
      setTooltip({ ...content, anchor: element.getBoundingClientRect() });
    }, TOOLTIP_DELAY_MS);
  }, []);

  // The pan tool is temporary, so the rail remembers where it came from. The
  // memory follows every tool change, including the ones a shortcut makes.
  useEffect(() => {
    rememberedRef.current = rememberTool(rememberedRef.current, toolId);
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

  // A click outside the rail and outside the flyout closes the flyout.
  useEffect(() => {
    if (openGroup === null) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (railRef.current?.contains(target)) {
        return;
      }
      if (target.closest(".tool-rail__menu")) {
        return;
      }
      closeMenu(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openGroup, closeMenu]);

  // Escape closes the flyout even when the focus is not inside it. It stops
  // the event, so the app's own Escape (clear the selection) stays behind it.
  useEffect(() => {
    if (openGroup === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      closeMenu(true);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openGroup, closeMenu]);

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
    const content = slotTooltip(slot, toolId, rememberedRef.current);

    if (slot.isMenu) {
      const group = slot.group;
      const isOpen = openGroup?.id === group.id;
      const armedTool = group.toolIds.includes(toolId) ? getToolDefinition(toolId) : null;
      return (
        <ToolRailButton
          key={group.id}
          label={armedTool ? `${group.label}, ${armedTool.label} active` : group.label}
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
            setOpenGroup({ id: group.id, anchor: event.currentTarget });
          }}
          onPointerEnter={(event) => showTooltip(event.currentTarget, content)}
          onPointerLeave={hideTooltip}
          onPointerDown={hideTooltip}
        >
          <span className="tool-rail__slot-icon">
            {armedTool ? TOOL_ICONS[toolId] : <IconShapes />}
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
        shortcut={tool.shortcut}
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
    ? slots.find((slot) => slot.group.id === openGroup.id)?.group ?? null
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
      {groups.map((groupSlots, index) => {
        const group = groupSlots[0].group;
        return (
          <Fragment key={group.id}>
            {index > 0 ? <div className="tool-rail__divider" aria-hidden="true" /> : null}
            <div className="tool-rail__group" role="group" aria-label={group.label}>
              {groupSlots.map(renderSlot)}
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
          onSelect={handleMenuSelect}
          onClose={() => closeMenu(true)}
        />
      ) : null}
    </div>
  );
}
