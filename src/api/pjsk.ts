export interface MusicData {
  id: number;
  title: string;
  composer: string;
  categories: string[];
  difficulties: Difficulty[];
}

export interface Difficulty {
  id: number;
  musicId: number;
  musicDifficulty: string;
  playLevel: number;
  totalNoteCount: number;
}

const DIFFICULTY_ORDER = ["easy", "normal", "hard", "expert", "master", "append"];

let loadedMusicsEN: MusicData[] = [];
let loadedMusicsJP: MusicData[] = [];

export async function loadSekaiData() {
  console.log("⏳ Fetching Project Sekai Database (EN & JP)...");
  try {
    const [enMusicsRes, enDiffsRes, jpMusicsRes, jpDiffsRes] = await Promise.all([
      fetch("https://raw.githubusercontent.com/Sekai-World/sekai-master-db-en-diff/main/musics.json"),
      fetch("https://raw.githubusercontent.com/Sekai-World/sekai-master-db-en-diff/main/musicDifficulties.json"),
      fetch("https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main/musics.json"),
      fetch("https://raw.githubusercontent.com/Sekai-World/sekai-master-db-diff/main/musicDifficulties.json"),
    ]);

    const processData = async (mRes: Response, dRes: Response) => {
        const musicsData: any[] = await mRes.json();
        const diffsData: Difficulty[] = await dRes.json();

        const diffsMap = diffsData.reduce((acc, diff) => {
          if (!acc[diff.musicId]) acc[diff.musicId] = [];
          acc[diff.musicId].push(diff);
          return acc;
        }, {} as Record<number, Difficulty[]>);

        return musicsData.map((m) => ({
          id: m.id,
          title: m.title,
          composer: m.composer,
          categories: m.categories,
          difficulties: (diffsMap[m.id] || []).sort(
            (a, b) =>
              DIFFICULTY_ORDER.indexOf(a.musicDifficulty) -
              DIFFICULTY_ORDER.indexOf(b.musicDifficulty)
          ),
        }));
    };

    loadedMusicsEN = await processData(enMusicsRes, enDiffsRes);
    loadedMusicsJP = await processData(jpMusicsRes, jpDiffsRes);

    console.log(`✅ Loaded ${loadedMusicsEN.length} EN songs and ${loadedMusicsJP.length} JP songs from PJSK API.`);
  } catch (error) {
    console.error("❌ Failed to fetch Sekai data:", error);
  }
}

export function getRandomSongsByLevelRange(
  minLevel: number, 
  maxLevel: number, 
  count: number, 
  allowedDifficulties: string[] = [],
  region: "EN" | "JP" = "EN",
  appendRange?: { min: number, max: number }
): { music: MusicData; difficulty: Difficulty }[] {
  // Find all possible (Song + Difficulty) pairs that fit the level range
  let possibleTracks: { music: MusicData; difficulty: Difficulty }[] = [];
  
  const targetDB = region === "JP" ? loadedMusicsJP : loadedMusicsEN;
  
  for (const music of targetDB) {
    for (const diff of music.difficulties) {
      const isAppend = diff.musicDifficulty.toLowerCase() === "append";
      
      // If passing appendRange, use it strictly for append diff, else use standard range
      const effectiveMin = isAppend && appendRange ? appendRange.min : minLevel;
      const effectiveMax = isAppend && appendRange ? appendRange.max : maxLevel;

      if (diff.playLevel >= effectiveMin && diff.playLevel <= effectiveMax) {
        if (allowedDifficulties.length > 0 && !allowedDifficulties.includes(diff.musicDifficulty.toLowerCase())) {
          continue;
        }
        possibleTracks.push({ music, difficulty: diff });
      }
    }
  }

  if (possibleTracks.length === 0) return [];

  // Shuffle array
  const shuffled = possibleTracks.sort(() => 0.5 - Math.random());
  
  // Pick requested count (ensure unique songs if possible)
  let selected: { music: MusicData; difficulty: Difficulty }[] = [];
  let seenMusicIds = new Set<number>();
  
  for (const track of shuffled) {
    if (!seenMusicIds.has(track.music.id)) {
      selected.push(track);
      seenMusicIds.add(track.music.id);
      if (selected.length === count) break;
    }
  }

  // Sort them from easiest to hardest
  return selected.sort((a, b) => a.difficulty.playLevel - b.difficulty.playLevel);
}

// For placement matches: pick exactly one song per level
export function getOneRandomSongPerLevel(
  levels: number[],
  allowedDifficulties: string[] = [],
  region: "EN" | "JP" = "EN"
): { music: MusicData; difficulty: Difficulty }[] {
  const targetDB = region === "JP" ? loadedMusicsJP : loadedMusicsEN;
  const selected: { music: MusicData; difficulty: Difficulty }[] = [];
  const seenMusicIds = new Set<number>();

  for (const level of levels) {
    // Gather all tracks at this exact level
    const tracksAtLevel: { music: MusicData; difficulty: Difficulty }[] = [];
    for (const music of targetDB) {
      if (seenMusicIds.has(music.id)) continue;
      for (const diff of music.difficulties) {
        if (diff.playLevel === level) {
          if (allowedDifficulties.length > 0 && !allowedDifficulties.includes(diff.musicDifficulty.toLowerCase())) continue;
          tracksAtLevel.push({ music, difficulty: diff });
        }
      }
    }

    if (tracksAtLevel.length > 0) {
      const pick = tracksAtLevel[Math.floor(Math.random() * tracksAtLevel.length)];
      selected.push(pick);
      seenMusicIds.add(pick.music.id);
    }
  }

  return selected.sort((a, b) => a.difficulty.playLevel - b.difficulty.playLevel);
}

export function calculateExpectedNotes(selectedTracks: { music: MusicData; difficulty: Difficulty }[]): number {
  return selectedTracks.reduce((sum, track) => sum + track.difficulty.totalNoteCount, 0);
}
