import { detectVolumeMarker, detectVolumes } from '../volumes';

describe('detectVolumeMarker', () => {
  it.each([
    ['Volume 2 Chapter 5', 'Volume 2'],
    ['Vol. 2 - Chapitre 12', 'Volume 2'],
    ['vol 3: the fall', 'Volume 3'],
    ['Tome 2 – Chapitre 1', 'Tome 2'],
    ['Livre 2, chapitre 4', 'Livre 2'],
    ['Arc 3 : Le tournoi', 'Arc 3'],
    ['Book IV – Chapter 1', 'Book IV'],
    ['第二卷 第五章', '第二卷'],
    ['卷3 第十章', '第3卷'],
  ])('%s → %s', (title, label) => {
    expect(detectVolumeMarker(title)?.label).toBe(label);
  });

  it.each([
    'Chapter 12',
    'Chapitre 5 : Le livre perdu',
    'The arcane arts',
    'Revolver 2',
    'Arc de triomphe',
  ])('ignores "%s"', (title) => {
    expect(detectVolumeMarker(title)).toBeNull();
  });
});

describe('detectVolumes', () => {
  it('groups consecutive chapters and keeps unmarked chapters in the current volume', () => {
    const result = detectVolumes([
      'Prologue',
      'Volume 1 Chapter 1',
      'Chapter 2',
      'Volume 2 Chapter 3',
      'Volume 2 Chapter 4',
    ]);
    expect(result.volumes).toEqual([{ title: 'Volume 1' }, { title: 'Volume 2' }]);
    expect(result.assignment).toEqual([null, 0, 0, 1, 1]);
  });

  it('detects nothing with a single volume', () => {
    const result = detectVolumes(['Volume 1 Chapter 1', 'Volume 1 Chapter 2']);
    expect(result.volumes).toEqual([]);
    expect(result.assignment).toEqual([null, null]);
  });
});
