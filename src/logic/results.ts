import {
  ActiveRoom,
  activeRooms,
  getRankName,
  updateRoomStatusDisplay,
  stopAllPlayerTimers,
} from "./matchmaking";
import {
  getUser,
  setUserMmrAbsolute,
  updateUserMmr,
  getCurrentSeason,
} from "../db/database";
import {
  EmbedBuilder,
  TextChannel,
  ThreadChannel,
  AttachmentBuilder,
} from "discord.js";
import { generateResultImage } from "./imageGenerator";
import { syncUserRole } from "./roles";

function calculatePlacementMmr(ge: number): number {
  // 0 GE = Champion (800)
  if (ge === 0) return 800;

  // Pieces based on SEKAIBOT.md thresholds
  // GE 1-5 -> Master Up (799-750)
  if (ge <= 5) return 800 - ge * 10;
  // GE 6-10 -> Master (749-700)
  if (ge <= 10) return 750 - (ge - 5) * 10;
  // GE 11-15 -> Crystal Up (699-650)
  if (ge <= 15) return 700 - (ge - 10) * 10;
  // GE 16-25 -> Crystal (649-600)
  if (ge <= 25) return 650 - (ge - 15) * 5;
  // GE 26-40 -> Diamond Up (599-550)
  if (ge <= 40) return 600 - (ge - 25) * 3.33;
  // GE 41-75 -> Diamond (549-500)
  if (ge <= 75) return 550 - (ge - 40) * 1.42;
  // GE 76-120 -> Platinum Up (499-450)
  if (ge <= 120) return 500 - (ge - 75) * 1.11;
  // GE 121-200 -> Platinum (449-400)
  if (ge <= 200) return 450 - (ge - 120) * 0.62;
  // GE 201-350 -> Gold Up (399-350)
  if (ge <= 350) return 400 - (ge - 200) * 0.33;
  // GE 351-500 -> Gold (349-300)
  if (ge <= 500) return 350 - (ge - 350) * 0.33;
  // GE 501-800 -> Silver Up (299-250)
  if (ge <= 800) return 300 - (ge - 500) * 0.16;
  // GE 801-1200 -> Silver (249-200)
  if (ge <= 1200) return 250 - (ge - 800) * 0.12;
  // GE 1201-1700 -> Bronze Up (199-150)
  if (ge <= 1700) return 200 - (ge - 1201) * 0.1;
  // GE 1701-2500 -> Bronze (149-100)
  if (ge <= 2500) return 150 - (ge - 1701) * 0.06;
  // GE 2501-4000 -> Iron Up (99-50)
  if (ge <= 4000) return 100 - (ge - 2501) * 0.033;
  // Everything else -> Iron
  return Math.max(0, 50 - (ge - 4000) * 0.01);
}

export async function finalizeMatch(
  room: ActiveRoom,
  channel: TextChannel | ThreadChannel,
) {
  room.status = "submitted";
  const seasonId = await getCurrentSeason();

  // Convert submissions to an array
  const playerResults = Object.entries(room.submissions).map(
    ([discordId, stats]) => {
      return {
        discordId,
        ...stats,
      };
    },
  );

  // Sort by score descending
  playerResults.sort((a, b) => b.score - a.score);

  // Filter to find MVP accurately based off highest acc (if tie, sort preserves score usually)
  const highestAcc = Math.max(...playerResults.map((p) => p.accuracy));

  // Calculate Elo Deltas
  const K = 9.75;
  const eloDeltas = new Array(playerResults.length).fill(0);

  for (let i = 0; i < playerResults.length; i++) {
    for (let j = i + 1; j < playerResults.length; j++) {
      const userA = await getUser(playerResults[i].discordId);
      const userB = await getUser(playerResults[j].discordId);
      const mmrA = userA.mmr;
      const mmrB = userB.mmr;

      const expectedA = 1 / (1 + Math.pow(10, (mmrB - mmrA) / 400));
      const expectedB = 1 / (1 + Math.pow(10, (mmrA - mmrB) / 400));

      if (playerResults[i].score === playerResults[j].score) {
        // DRAW: No MMR transfer between these two players for this match
        continue;
      }

      let sa = 1;
      let sb = 0;
      eloDeltas[i] += K * (sa - expectedA);
      eloDeltas[j] += K * (sb - expectedB);
    }
  }

  // Give MMR
  const updatedPlayers = [];
  for (let index = 0; index < playerResults.length; index++) {
    const result = playerResults[index];
    const u = await getUser(result.discordId);
    let mmrChange = 0;
    let newMmr = u.mmr;
    let isPlacement = false;

    if (!u.is_ranked) {
      // Placement logic
      isPlacement = true;
      // Great Equivalent (GE) calculation
      const ge =
        result.perfects === 0 && result.score === 0
          ? 9999
          : result.greats * 1 +
            result.goods * 2 +
            result.bads * 3 +
            result.misses * 4;
      const baseMmr = calculatePlacementMmr(ge);

      // Elo bonus: Even placement players get elo adjustments based on their rank relative to others
      const bonus = Math.max(-39, Math.min(39, Math.round(eloDeltas[index])));

      newMmr = Math.round(baseMmr + bonus);
      mmrChange = bonus; 
      await setUserMmrAbsolute(result.discordId, newMmr, seasonId);

      // To make the image and text show clear transition:
      // We'll treat baseMmr as "oldMmr" for the visual transition
    } else {
      // Standard elo logic
      mmrChange = Math.round(eloDeltas[index]);
      mmrChange = Math.max(-39, Math.min(39, mmrChange)); // Cap at +/- 39
      // A "Win" is ONLY for the 1st place player (index 0)
      const isWin = index === 0;
      newMmr = await updateUserMmr(
        result.discordId,
        mmrChange,
        isWin,
        seasonId,
      );
    }

    // Auto role sync
    syncUserRole(channel.guild, result.discordId).catch(console.error);

    updatedPlayers.push({ ...result, mmrChange, newMmr, isPlacement });
  }

  const songListString = room.songs
    .map(
      (s, i) =>
        `${i + 1}. **${s.music.title}** [${s.difficulty.musicDifficulty.toUpperCase()} - Lv ${s.difficulty.playLevel}] (${s.difficulty.totalNoteCount} notes)`,
    )
    .join("\n");
  const playLevels = room.songs.map((s) => s.difficulty.playLevel);
  const minLevel = Math.min(...playLevels);
  const maxLevel = Math.max(...playLevels);

  // Construct Result Embed
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Season ${seasonId} Match Results`)
    .setColor("#00FFFF")
    .setDescription(
      `**Room Avg MMR:** ${room.averageMmr}\n**Song Level Range:** ${minLevel} ~ ${maxLevel}\n**Total Notes:** ${room.expectedTotalNotes}\n\n**Setlist:**\n${songListString}\n\n**The match has concluded. Here are the final standings:**`,
    )
    .setTimestamp();

  // Build the leaderboard string (Reverting to original simple layout as requested)
  let leaderboardString = "";
  const placementEmojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
  const imagePlayers = [];
  for (let i = 0; i < updatedPlayers.length; i++) {
    const p = updatedPlayers[i];
    let username = "Unknown";
    try {
      const discordUser = await (channel.client as any).users.fetch(p.discordId);
      username = discordUser.username;
    } catch (e) {}

    const sign = p.mmrChange >= 0 ? "+" : "";
    leaderboardString += `${placementEmojis[i]} **${username}**\n`;
    leaderboardString += `├  **Score:** ${p.score} pts | **Acc:** ${p.accuracy.toFixed(2)}%\n`;
    const oldMmr = p.isPlacement
      ? Math.round(p.newMmr - p.mmrChange)
      : Math.max(0, p.newMmr - p.mmrChange);

    if (p.isPlacement) {
      leaderboardString += `└  **PLACED AT:** ${oldMmr} -> ${p.newMmr} (${sign}${p.mmrChange} MMR) [${getRankName(p.newMmr)}]\n\n`;
    } else {
      leaderboardString += `└  **MMR:** ${oldMmr} -> ${p.newMmr} (${sign}${p.mmrChange} MMR) [${getRankName(p.newMmr)}]\n\n`;
    }

    imagePlayers.push({
      username: username,
      region: p.region || "[??]",
      perfects: p.perfects,
      greats: p.greats,
      goods: p.goods,
      bads: p.bads,
      misses: p.misses,
      score: p.score,
      mmrChange: p.mmrChange,
      oldMmr: oldMmr,
      newMmr: p.newMmr,
      isPlacement: p.isPlacement,
    });
  }

  // Calculate total room faults (Misses + Bads)
  const totalFaults = playerResults.reduce(
    (sum, p) => sum + p.misses + p.bads,
    0,
  );

  embed.addFields({
    name: "📊 Standings",
    value: leaderboardString || "No data.",
  });

  // Generate the dynamic image
  const imageBuffer = await generateResultImage(
    room.averageMmr,
    imagePlayers,
    seasonId,
  );
  const attachment = new AttachmentBuilder(imageBuffer, {
    name: "room_result.png",
  });
  embed.setImage("attachment://room_result.png");
  
  // Send it to the respective results channel
  try {
    const targetChannelName = room.region === "JP" ? "jp-results" : "results";
    const resultsChannel = channel.guild.channels.cache.find(
      (c) => c.name === targetChannelName,
    ) as TextChannel;
    if (resultsChannel) {
      await resultsChannel.send({
        content: `Match in **${room.roomName}** finalized!`,
        embeds: [embed],
        files: [attachment],
      });
      await channel.send(
        `✅ **Match Finalized!** The results have been posted to **#${resultsChannel.name}**.`,
      );
    } else {
      await channel.send({
        content: `⚠️ Could not find \`#${targetChannelName}\` channel. Posting here instead:`,
        embeds: [embed],
        files: [attachment],
      });
    }
  } catch (e) {
    await channel.send({ embeds: [embed], files: [attachment] });
  }

  // Clean up timers
  stopAllPlayerTimers(room);

  // Clean up room memory
  activeRooms.delete(room.roomId);
  await updateRoomStatusDisplay(channel.client, channel.guildId!);

  // Automatic shutdown countdown (30s)
  let secondsLeft = 30;
  const countdownMsg = await channel.send(
    `⏳ **Match Finalized.** This thread will be automatically deleted in **${secondsLeft} seconds**.`,
  );

  const interval = setInterval(async () => {
    secondsLeft -= 5;
    if (secondsLeft <= 0) {
      clearInterval(interval);
      try {
        await (channel as any).delete();
      } catch (e) {}
    } else {
      try {
        await countdownMsg.edit(
          `⏳ **Match Finalized.** This thread will be automatically deleted in **${secondsLeft} seconds**.`,
        );
      } catch (e) {
        clearInterval(interval);
      }
    }
  }, 5000);
}
