/**
 * The document title and its unsaved marker.
 *
 * One chip in the app bar: the name is read once, and the dot that says the
 * document differs from the file travels with it. The window title and the
 * status bar use the same label, so the name is never shown twice in two
 * different forms.
 */

export interface DocumentTitleProps {
  /** The document's name, or the file's name once it has a path. */
  readonly label: string;
  /** True when the document has changes that are not on disk. */
  readonly dirty: boolean;
  /** The full path, when there is one; shown as the tooltip. */
  readonly path?: string | null;
}

export function DocumentTitle({ label, dirty, path }: DocumentTitleProps) {
  return (
    <span
      className="doc-title"
      title={path ?? "Not saved to a file yet"}
    >
      <span className="doc-title__name">{label}</span>
      {dirty ? (
        <span
          className="doc-title__dirty"
          role="img"
          aria-label="Unsaved changes"
          title="Unsaved changes"
        >
          ●
        </span>
      ) : null}
    </span>
  );
}
