import { Pool } from "pg";

type UserRow = {
  discord_id: string;
  mmr: number;
  peak_mmr: number;
  total_matches: number;
  wins: number;
  losses: number;
  is_ranked: boolean;
  last_played_season: number;
};

const DEFAULT_USER: Omit<UserRow, "discord_id"> = {
  mmr: 0,
  peak_mmr: 0,
  total_matches: 0,
  wins: 0,
  losses: 0,
  is_ranked: false,
  last_played_season: 0,
};

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const useSsl = process.env.DB_SSL === "true";

export const db = connectionString
  ? new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || "5432"),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "sekai_bot",
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });

export async function initDB() {
  await db.query("SELECT 1");
  const target = connectionString
    ? "DATABASE_URL/SUPABASE_DB_URL"
    : `${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "sekai_bot"}`;
  console.log(`✅ PostgreSQL connected (${target})`);
}

export async function getCurrentSeason(): Promise<number> {
  const res = await db.query<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'current_season'"
  );
  return parseInt(res.rows[0]?.value || "1", 10);
}

export async function setCurrentSeason(seasonId: number): Promise<void> {
  await db.query(
    "UPDATE settings SET value = $1 WHERE key = 'current_season'",
    [seasonId.toString()]
  );
}

export async function resetSeason() {
  const currentSeason = await getCurrentSeason();
  const nextSeason = currentSeason + 1;

  const activePlayers = (
    await db.query<UserRow>("SELECT * FROM users WHERE last_played_season = $1", [currentSeason])
  ).rows;

  for (const user of activePlayers) {
    const newMmr = user.mmr >= 900 ? 800 : Math.max(0, user.mmr - 50);
    await db.query(
      `
      UPDATE users
      SET mmr = $1,
          peak_mmr = $1,
          is_ranked = TRUE
      WHERE discord_id = $2
      `,
      [newMmr, user.discord_id]
    );
  }

  await setCurrentSeason(nextSeason);

  return {
    oldSeason: currentSeason,
    newSeason: nextSeason,
    affectedPlayers: activePlayers.length,
  };
}

export async function getUser(discordId: string): Promise<UserRow> {
  const found = await db.query<UserRow>("SELECT * FROM users WHERE discord_id = $1", [discordId]);
  if (found.rows[0]) return found.rows[0];

  await db.query(
    `
    INSERT INTO users (discord_id, mmr, peak_mmr, total_matches, wins, losses, is_ranked, last_played_season)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      discordId,
      DEFAULT_USER.mmr,
      DEFAULT_USER.peak_mmr,
      DEFAULT_USER.total_matches,
      DEFAULT_USER.wins,
      DEFAULT_USER.losses,
      DEFAULT_USER.is_ranked,
      DEFAULT_USER.last_played_season,
    ]
  );

  return { discord_id: discordId, ...DEFAULT_USER };
}

export async function updateUserMmr(
  discordId: string,
  mmrChange: number,
  isWin: boolean,
  seasonId: number
): Promise<number> {
  const user = await getUser(discordId);
  const newMmr = Math.max(0, user.mmr + mmrChange);
  const newPeak = Math.max(user.peak_mmr, newMmr);

  await db.query(
    `
    UPDATE users
    SET mmr = $1,
        peak_mmr = $2,
        total_matches = total_matches + 1,
        wins = wins + $3,
        losses = losses + $4,
        is_ranked = TRUE,
        last_played_season = $5
    WHERE discord_id = $6
    `,
    [newMmr, newPeak, isWin ? 1 : 0, isWin ? 0 : 1, seasonId, discordId]
  );

  await db.query(
    `
    INSERT INTO match_history (discord_id, mmr_change, is_win, is_placement, season_id)
    VALUES ($1, $2, $3, FALSE, $4)
    `,
    [discordId, mmrChange, isWin, seasonId]
  );

  return newMmr;
}

export async function setUserMmrAbsolute(discordId: string, mmr: number, seasonId: number): Promise<void> {
  const user = await getUser(discordId);
  const newPeak = Math.max(user.peak_mmr, mmr);

  await db.query(
    `
    UPDATE users
    SET mmr = $1,
        peak_mmr = $2,
        total_matches = total_matches + 1,
        is_ranked = TRUE,
        last_played_season = $3
    WHERE discord_id = $4
    `,
    [mmr, newPeak, seasonId, discordId]
  );

  const diff = mmr - user.mmr;
  await db.query(
    `
    INSERT INTO match_history (discord_id, mmr_change, is_win, is_placement, season_id)
    VALUES ($1, $2, $3, TRUE, $4)
    `,
    [discordId, diff, diff > 0, seasonId]
  );
}

export async function getTopPlayers(limit = 10, offset = 0): Promise<UserRow[]> {
  const res = await db.query<UserRow>(
    `
    SELECT * FROM users
    WHERE is_ranked = TRUE
    ORDER BY mmr DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );
  return res.rows;
}

export async function getUserMatchHistory(discordId: string, limit = 10) {
  const res = await db.query(
    `
    SELECT * FROM match_history
    WHERE discord_id = $1
    ORDER BY "timestamp" DESC
    LIMIT $2
    `,
    [discordId, limit]
  );
  return res.rows;
}

export async function getLeaderboardPosition(discordId: string): Promise<number> {
  const res = await db.query<{ rank: string }>(
    `
    SELECT COUNT(*) as rank
    FROM users
    WHERE mmr > (SELECT mmr FROM users WHERE discord_id = $1)
      AND is_ranked = TRUE
    `,
    [discordId]
  );
  return (parseInt(res.rows[0]?.rank || "0", 10) || 0) + 1;
}

export async function getMmrCutoffs() {
  const [top10, top20, top50, top100] = await Promise.all([
    db.query<{ mmr: number }>("SELECT mmr FROM users WHERE is_ranked = TRUE ORDER BY mmr DESC LIMIT 1 OFFSET 9"),
    db.query<{ mmr: number }>("SELECT mmr FROM users WHERE is_ranked = TRUE ORDER BY mmr DESC LIMIT 1 OFFSET 19"),
    db.query<{ mmr: number }>("SELECT mmr FROM users WHERE is_ranked = TRUE ORDER BY mmr DESC LIMIT 1 OFFSET 49"),
    db.query<{ mmr: number }>("SELECT mmr FROM users WHERE is_ranked = TRUE ORDER BY mmr DESC LIMIT 1 OFFSET 99"),
  ]);

  return {
    top10: top10.rows[0]?.mmr || 0,
    top20: top20.rows[0]?.mmr || 0,
    top50: top50.rows[0]?.mmr || 0,
    top100: top100.rows[0]?.mmr || 0,
  };
}
