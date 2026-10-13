import { useState } from 'react';
import { applyUpdate, CURRENT, formatBuildTime, useLatestVersion } from '../updates';

/** Top right: when this version was published, and a button when a newer one is out. */
export function UpdateBadge() {
  const latest = useLatestVersion();
  const [updating, setUpdating] = useState(false);
  const dev = import.meta.env.DEV;
  if (latest) {
    return (
      <button
        className="update-badge new"
        disabled={updating}
        onClick={() => {
          setUpdating(true);
          void applyUpdate();
        }}
        title={`You have the version from ${formatBuildTime(CURRENT.builtAt)}. Click to switch to the new one.`}
      >
        {updating ? 'Updating…' : `⟳ Update available · ${formatBuildTime(latest.builtAt)}`}
      </button>
    );
  }
  return (
    <span className="update-badge" title={dev ? 'Development build' : `Version ${CURRENT.id}. Pianist checks for updates every few minutes and each time you open it.`}>
      {dev ? 'Dev build' : `Updated ${formatBuildTime(CURRENT.builtAt)}`}
    </span>
  );
}
