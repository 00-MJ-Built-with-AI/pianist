import { useEffect, useRef, useState } from 'react';
import { activeProfile, addProfile, AVATARS, listProfiles, switchProfile } from '../store/profiles';

/** The current player in the header, with switching and adding players. */
export function ProfileMenu() {
  const me = activeProfile();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[1]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="add-list" ref={box}>
      <button className="chip-btn profile-chip" onClick={() => setOpen(!open)} title="Switch player">
        <span className="avatar">{me.avatar}</span>
        {me.name}
      </button>
      {open && (
        <div className="list-menu profile-menu" role="menu">
          <div className="list-menu-title">Who's playing?</div>
          {listProfiles().map((p) => (
            <button
              key={p.id}
              className={`list-menu-new profile-row ${p.id === me.id ? 'active' : ''}`}
              onClick={() => (p.id === me.id ? setOpen(false) : switchProfile(p.id))}
            >
              <span className="avatar">{p.avatar}</span>
              {p.name}
              {p.id === me.id && <span className="muted small"> · playing</span>}
            </button>
          ))}
          {adding ? (
            <div className="profile-add">
              <input className="name-field" autoFocus placeholder="Name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
              <div className="avatar-pick">
                {AVATARS.map((a) => (
                  <button key={a} className={a === avatar ? 'on' : ''} onClick={() => setAvatar(a)}>
                    {a}
                  </button>
                ))}
              </div>
              <button className="btn primary" disabled={!name.trim()} onClick={() => switchProfile(addProfile(name, avatar).id)}>
                Add and switch
              </button>
            </div>
          ) : (
            <button className="list-menu-new" onClick={() => setAdding(true)}>
              ＋ Add a player
            </button>
          )}
          <div className="muted small" style={{ padding: '4px 8px' }}>
            Each player has their own progress, lists and settings. Imported songs are shared.
          </div>
        </div>
      )}
    </div>
  );
}
