/** Which deploy this is, for a bug report: the same stamp the console logs at startup. */
export function BuildStamp() {
  return (
    <p className="text-xs text-hint">
      Build <span className="tabular-nums">{__BUILD_VERSION__}</span>
    </p>
  );
}
