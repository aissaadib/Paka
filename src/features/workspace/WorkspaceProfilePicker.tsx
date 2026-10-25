/**
 * The workspace profile picker: the control that lists the profiles and
 * adopts one.
 *
 * The control is a thin shell over the profile store: it reads the profiles,
 * it hands the choice to `switchTo`, and it reports a refusal in the title
 * attribute. All the rules - what a profile may be called, which layout it
 * may carry, what happens to the saved profiles when the window is rearranged
 * - belong to the model in `core/workspace/workspaceProfiles.ts` and to the
 * store in `core/workspace/workspaceProfileStore.ts`.
 *
 * The control is deliberately plain: a list of the saved arrangements and the
 * one that is showing. The name of a *new* profile needs a name entry, which
 * belongs with the menu bar rather than with this control.
 */

import { useState } from "react";
import { useWorkspaceProfileActions, useWorkspaceProfiles } from "../../hooks/useWorkspaceProfiles";

export interface WorkspaceProfilePickerProps {
  /** The class the control is drawn with. */
  readonly className?: string;
}

export function WorkspaceProfilePicker({ className }: WorkspaceProfilePickerProps) {
  const { profiles, active } = useWorkspaceProfiles();
  const actions = useWorkspaceProfileActions();
  const [refusal, setRefusal] = useState<string | null>(null);

  /** Adopts the profile the user picked. */
  const choose = (name: string): void => {
    if (name === "") {
      return;
    }
    const outcome = actions.switchTo(name);
    setRefusal(outcome.ok ? null : (outcome.detail ?? "the profile could not be adopted"));
  };

  return (
    <label className={className ?? "workspace-profiles"} title={refusal ?? undefined}>
      <span className="workspace-profiles__label">Layout</span>
      <select
        className="workspace-profiles__select"
        value={active ?? ""}
        onChange={(event) => choose(event.target.value)}
      >
        {active === undefined ? (
          <option value="">Custom</option>
        ) : null}
        {profiles.map((profile) => (
          <option key={profile.name} value={profile.name}>
            {profile.name}
          </option>
        ))}
      </select>
    </label>
  );
}
