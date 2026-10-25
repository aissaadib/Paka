/**
 * Panel chrome for right-hand side panels.
 *
 * Provides the header, optional action row and scrollable body used by the
 * layers panel; kept generic so future panels (color, brush presets) match.
 */

import type { ReactNode } from "react";

export interface PanelProps {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

export function Panel({ title, actions, footer, children }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">{title}</h2>
        {actions ? <div className="panel__actions">{actions}</div> : null}
      </header>
      <div className="panel__body">{children}</div>
      {footer ? <div className="panel__footer">{footer}</div> : null}
    </section>
  );
}
