import { describe, expect, it } from 'vitest';
import { addSongs, moveSong, newCollection, toggleSong, withoutSong } from './collections';

describe('collections', () => {
  it('adds without duplicates and toggles songs', () => {
    let c = addSongs(newCollection('  Avatar  '), ['a', 'b', 'a']);
    expect(c.name).toBe('Avatar');
    expect(c.songIds).toEqual(['a', 'b']);
    c = toggleSong(c, 'b');
    expect(c.songIds).toEqual(['a']);
    c = toggleSong(c, 'c');
    expect(c.songIds).toEqual(['a', 'c']);
  });

  it('reorders within bounds', () => {
    const c = addSongs(newCollection('x'), ['a', 'b', 'c']);
    expect(moveSong(c, 'c', -1).songIds).toEqual(['a', 'c', 'b']);
    expect(moveSong(c, 'a', -1)).toBe(c);
    expect(moveSong(c, 'c', 1)).toBe(c);
  });

  it('removes a deleted song from every collection that has it', () => {
    const a = addSongs(newCollection('a'), ['s1', 's2']);
    const b = addSongs(newCollection('b'), ['s3']);
    const changed = withoutSong([a, b], 's1');
    expect(changed).toHaveLength(1);
    expect(changed[0].songIds).toEqual(['s2']);
  });

  it('falls back to a default name', () => {
    expect(newCollection('   ').name).toBe('My collection');
  });
});
