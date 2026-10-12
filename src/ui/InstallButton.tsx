import { useEffect, useState } from 'react';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** "Install app" when the browser offers it; on iPhone / iPad, how to add it to the home screen. */
export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [iosHelp, setIosHelp] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;
  if (prompt) {
    return (
      <button
        className="btn"
        title="Install Pianist as an app; it also works offline"
        onClick={async () => {
          await prompt.prompt();
          const choice = await prompt.userChoice;
          if (choice.outcome === 'accepted') setInstalled(true);
          setPrompt(null);
        }}
      >
        ⬇ Install app
      </button>
    );
  }
  if (!isIos()) return null;
  return (
    <div className="add-list">
      <button className="btn" onClick={() => setIosHelp(!iosHelp)}>
        ⬇ Install app
      </button>
      {iosHelp && (
        <div className="list-menu" role="note">
          <div className="small" style={{ padding: 8, lineHeight: 1.5 }}>
            In Safari, tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>. On iPad and iPhone, Pianist hears your
            piano through the microphone; Safari doesn't support MIDI.
          </div>
        </div>
      )}
    </div>
  );
}
