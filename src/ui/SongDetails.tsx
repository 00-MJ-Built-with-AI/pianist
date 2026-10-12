import { useState } from 'react';
import type { Song } from '../music/types';
import { getSongMeta, setSongMeta } from '../store/songMeta';

const EMOJIS = ['', '🎹', '🎵', '⭐', '❤️', '🔥', '🌙', '🌸', '🎄', '🏆', '📚', '🎬', '🐉', '🌊', '☀️', '🍀'];
export const CARD_COLORS = ['', '#4c9dff', '#38c98a', '#ffd166', '#ff7a59', '#ff5d6c', '#a78bfa', '#f472b6', '#22d3ee'];
const LEVELS = ['First steps', 'Beginner', 'Elementary', 'Intermediate', 'Advanced'];

/** Edit how a song appears: name, emoji, colour, level, tags, notes, favourite. */
export function SongDetails({ song, onClose }: { song: Song; onClose: () => void }) {
  const meta = getSongMeta(song.id);
  const [title, setTitle] = useState(meta.title ?? song.title);
  const [emoji, setEmoji] = useState(meta.emoji ?? '');
  const [color, setColor] = useState(meta.color ?? '');
  const [level, setLevel] = useState(meta.level ?? song.level);
  const [tags, setTags] = useState((meta.tags ?? []).join(', '));
  const [notes, setNotes] = useState(meta.notes ?? '');
  const [favorite, setFavorite] = useState(!!meta.favorite);

  const save = () => {
    setSongMeta(song.id, {
      title: title.trim() && title.trim() !== song.title ? title.trim() : undefined,
      emoji: emoji || undefined,
      color: color || undefined,
      level: level !== song.level ? level : undefined,
      tags: tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      notes: notes.trim() || undefined,
      favorite,
    });
    onClose();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal song-details" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Song details">
        <h2>Song details</h2>
        <div className="form column">
          <label>
            Name
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </label>
          <div className="opt-row">
            <span className="muted small">Emoji</span>
            <div className="avatar-pick">
              {EMOJIS.map((e) => (
                <button key={e || 'none'} className={e === emoji ? 'on' : ''} onClick={() => setEmoji(e)} title={e ? e : 'None'}>
                  {e || '∅'}
                </button>
              ))}
            </div>
          </div>
          <div className="opt-row">
            <span className="muted small">Colour</span>
            <div className="swatches">
              {CARD_COLORS.map((c) => (
                <button
                  key={c || 'none'}
                  className={`swatch ${c === color ? 'on' : ''}`}
                  style={{ background: c || 'transparent' }}
                  onClick={() => setColor(c)}
                  title={c || 'None'}
                >
                  {c ? '' : '∅'}
                </button>
              ))}
            </div>
          </div>
          <label>
            Level
            <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {LEVELS.map((l, i) => (
                <option key={l} value={i + 1}>
                  {i + 1} · {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tags <span className="muted">(comma separated, e.g. recital, christmas)</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label>
            Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fingering reminders, teacher's comments…" />
          </label>
          <label className="check">
            <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
            Favourite (pinned at the top)
          </label>
        </div>
        <div className="report-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
