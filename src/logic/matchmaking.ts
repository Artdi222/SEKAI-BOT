import { getUser, getCurrentSeason } from "../db/database";
import { getRandomSongsByLevelRange, getOneRandomSongPerLevel, MusicData, Difficulty} from "../api/pjsk";
import { EmbedBuilder, TextChannel, Client, Guild } from "discord.js";

// Memory storage for active rooms
export interface ActiveRoom {
  roomId: string;
  roomName?: string;
  hostId: string;
  players: string[];
  status: "open" | "playing" | "submitted";
  averageMmr: number;
  songs: { music: MusicData; difficulty: Difficulty }[];
  expectedTotalNotes: number;
  submissions: Record<string, { perfects: number; greats: number; goods: number; bads: number; misses: number, score: number, accuracy: number, region: string, attachmentUrl?: string }>;
  statusMessageId?: string;
  playerTimers: Record<string, { warn: any, kick: any }>;
  forfeitVotes: string[];
  region: "EN" | "JP";
}

export const activeRooms = new Map<string, ActiveRoom>();

function getAppendChanceByAverageMmr(avgMmr: number): number {
  if (avgMmr < 400) return 0;
  if (avgMmr < 600) return 0.02;
  if (avgMmr < 700) return 0.035;
  if (avgMmr < 800) return 0.05;
  if (avgMmr < 850) return 0.08;
  if (avgMmr < 1000) return 0.15;
  return 0.35;
}

function maybeIncludeAppendDifficulty(baseDifficulties: string[], avgMmr: number): string[] {
  if (!baseDifficulties.includes("append")) return baseDifficulties;
  const appendChance = getAppendChanceByAverageMmr(avgMmr);
  if (Math.random() <= appendChance) return baseDifficulties;
  return baseDifficulties.filter(d => d !== "append");
}

export function getRankName(mmr: number, isRanked: boolean | number = true): string {
  if (!isRanked) return "Placement";
  if (mmr >= 1000) return "Legend";
  if (mmr >= 950) return "Divine Star";
  if (mmr >= 900) return "Star";
  if (mmr >= 850) return "Grand Champion";
  if (mmr >= 800) return "Champion";
  if (mmr >= 750) return "Master up";
  if (mmr >= 700) return "Master";
  if (mmr >= 650) return "Crystal up";
  if (mmr >= 600) return "Crystal";
  if (mmr >= 550) return "Diamond up";
  if (mmr >= 500) return "Diamond";
  if (mmr >= 450) return "Platinum up";
  if (mmr >= 400) return "Platinum";
  if (mmr >= 350) return "Gold up";
  if (mmr >= 300) return "Gold";
  if (mmr >= 250) return "Silver up";
  if (mmr >= 200) return "Silver";
  if (mmr >= 150) return "Bronze up";
  if (mmr >= 100) return "Bronze";
  if (mmr >= 50) return "Iron up";
  return "Iron";
}

export async function generateRoomMatchmaking(players: string[], region: "EN" | "JP"): Promise<{ 
  success: boolean; 
  error?: string; 
  averageMmr?: number; 
  songs?: { music: MusicData; difficulty: Difficulty }[] 
}> {
  const users = await Promise.all(players.map(id => getUser(id)));
  const mmrs = users.map(u => u.mmr);
  const avgMmr = Math.round(mmrs.reduce((a, b) => a + b, 0) / players.length);
  
  // Placement check: Are any players unranked?
  const hasUnranked = users.some(u => !u.is_ranked);
  // 1. Tier Lock calculation
  const maxMmr = Math.max(...mmrs);
  const minMmr = Math.min(...mmrs);
  
  if (maxMmr - minMmr > 400) {
      return { success: false, error: `The skill gap in this room is too high for a fair match (Difference: ${maxMmr - minMmr} > 400 MMR cap). Please adjust the lobby!` };
  }

  let songs: { music: MusicData; difficulty: Difficulty }[] = [];

  if (hasUnranked) {
    // Placement matches: pick exactly one song per level (24, 25, 26, 27, 28)
    songs = getOneRandomSongPerLevel([24, 25, 26, 27, 28], ["expert"], region);
  } else {
    // Standard Ranked Play based on Dynamic MMR rules
    if (avgMmr < 100) {
      songs = getRandomSongsByLevelRange(23, 26, 5, ["hard", "expert"], region);
    } else if (avgMmr < 250) {
      songs = getRandomSongsByLevelRange(26, 28, 5, ["expert"], region);
    } else if (avgMmr < 400) {
      songs = getRandomSongsByLevelRange(28, 30, 5, ["expert", "master"], region);
    } else if (avgMmr < 600) {
      songs = getRandomSongsByLevelRange(30, 31, 5, ["expert", "master"], region);
    } else if (avgMmr < 650) {
      songs = getRandomSongsByLevelRange(30, 31, 5, maybeIncludeAppendDifficulty(["expert", "master", "append"], avgMmr), region, { min: 25, max: 28 });
    } else if (avgMmr < 700) {
      songs = getRandomSongsByLevelRange(30, 32, 5, maybeIncludeAppendDifficulty(["expert", "master", "append"], avgMmr), region, { min: 26, max: 29 });
    } else if (avgMmr < 750) {
      songs = getRandomSongsByLevelRange(31, 33, 5, maybeIncludeAppendDifficulty(["expert", "master", "append"], avgMmr), region, { min: 27, max: 30 });
    } else if (avgMmr < 800) {
      songs = getRandomSongsByLevelRange(31, 33, 5, maybeIncludeAppendDifficulty(["expert", "master", "append"], avgMmr), region, { min: 29, max: 31 });
    } else if (avgMmr < 850) {
      songs = getRandomSongsByLevelRange(32, 34, 5, maybeIncludeAppendDifficulty(["expert", "master", "append"], avgMmr), region, { min: 31, max: 33 });
    } else if (avgMmr < 1000) {
      songs = getRandomSongsByLevelRange(33, 36, 5, maybeIncludeAppendDifficulty(["master", "append"], avgMmr), region, { min: 33, max: 37 });
    } else {
      songs = getRandomSongsByLevelRange(34, 37, 5, ["master", "append"], region, { min: 35, max: 38 });
    }
  }

  if (songs.length < 5) {
      return { success: false, error: "Failed to generate 5 songs for this difficulty range. The API might still be loading."};
  }

  return { success: true, averageMmr: avgMmr, songs };
}

// Score Calculation Weighting
export function calculateScore(perfects: number, greats: number, goods: number, bads: number, misses: number) {
    // PERFECT: 4 pts | GREAT: 3 pts | GOOD: 1 pt | BAD: 0 pts | MISS: -2 pts
    return (perfects * 4) + (greats * 3) + (goods * 1) + (bads * 0) + (misses * -2);
}

export function calculateAccuracy(perfects: number, greats: number, goods: number, bads: number, misses: number, totalExpected: number) {
    // Standard Project Sekai Technical Accuracy Formula:
    // PERFECT: 3 pts | GREAT: 2 pts | GOOD: 1 pt | BAD/MISS: 0 pts
    const totalPoints = (perfects * 3) + (greats * 2) + (goods * 1);
    const maxPoints = totalExpected * 3;
    
    let accuracy = (totalPoints / maxPoints) * 100;

    // Safety: If there are ANY non-perfect notes, it should NOT be 100%
    if (accuracy === 100 && (greats + goods + bads + misses > 0)) {
        accuracy = 99.99;
    }

    return accuracy;
}

export async function updateRoomStatusDisplay(client: Client, guildId?: string) {
    if (!guildId) return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    await updateRegionRoomStatusDisplay(client, guild, "EN", "rooms");
    await updateRegionRoomStatusDisplay(client, guild, "JP", "jp-rooms");
}

async function updateRegionRoomStatusDisplay(client: Client, guild: Guild, region: "EN" | "JP", channelName: string) {
    const roomChannel = guild.channels.cache.find(c => c.name === channelName) as TextChannel;
    if (!roomChannel) return;

    try {
        const messages = await roomChannel.messages.fetch({ limit: 10 });
        const lastBotMessage = messages.find(m => m.author.id === client.user?.id);

        const seasonId = await getCurrentSeason();
        const embed = new EmbedBuilder()
            .setTitle(`📡 Season ${seasonId} Matchmaking (${region})`)
            .setTimestamp();

        const regionRooms = Array.from(activeRooms.entries()).filter(([_, room]) => room.region === region);

        if (regionRooms.length === 0) {
            embed.setColor("#94A3B8")
                 .setDescription(`There are currently no active matchmaking rooms for ${region} in the server.`);
        } else {
            embed.setColor("#00FFFF");
            let desc = "";
            for (const [roomId, room] of regionRooms) {
                const playerNames = room.players.map((id, index) => {
                    const u = client.users.cache.get(id);
                    const name = u ? u.username : `<@${id}>`;
                    const role = id === room.hostId ? " [HOST] 👑" : "";
                    return `${index + 1}. **${name}**${role}`;
                }).join('\n');

                const users = await Promise.all(room.players.map(id => getUser(id)));
                const isPlacement = users.some(u => !u.is_ranked);
                const mmrDisplay = isPlacement ? "**Placement Match**" : `**Avg MMR:** ${room.averageMmr}`;
                const statusEmoji = room.status === "open" ? "**OPEN**" : "**IN MATCH**";

                const displayName = room.roomName || `room-${roomId.slice(-4)}`;
                const roomLabel = `**${displayName}**`;
                desc += `💠 ${roomLabel} - ${statusEmoji}\n├ ${mmrDisplay}\n└ **Queue:**\n${playerNames}\n\n`;
                
                // Also update message inside the thread
                try {
                    const thread = await guild.channels.fetch(roomId);
                    if (thread?.isTextBased()) {
                        if ("name" in thread && typeof thread.name === "string" && thread.name.length > 0) {
                            room.roomName = thread.name;
                        }
                        const seasonId = await getCurrentSeason();
                        const threadEmbed = new EmbedBuilder()
                            .setTitle(`🎮 Season ${seasonId} Lobby Status`)
                            .setColor(isPlacement ? "#FBBF24" : "#00FFFF") // Yellow for placement
                            .setDescription(`**Lobby Status:** ${room.status.toUpperCase()}\n${mmrDisplay}\n\n**Players:**\n${playerNames}`)
                            .setTimestamp();
                        
                        if (room.statusMessageId) {
                            try {
                                const msg = await thread.messages.fetch(room.statusMessageId);
                                if (msg) await msg.edit({ embeds: [threadEmbed] });
                            } catch(e) {
                                const newMsg = await thread.send({ embeds: [threadEmbed] });
                                room.statusMessageId = newMsg.id;
                            }
                        } else {
                            const newMsg = await thread.send({ embeds: [threadEmbed] });
                            room.statusMessageId = newMsg.id;
                        }
                    }
                } catch(e) {}
            }
            embed.setDescription(desc);
        }

        if (lastBotMessage) {
            await lastBotMessage.edit({ content: "", embeds: [embed] });
        } else {
            await roomChannel.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error("Failed to update room display:", e);
    }
}

export async function calculateRoomAverageMmr(players: string[]): Promise<number> {
    if (players.length === 0) return 0;
    const users = await Promise.all(players.map(id => getUser(id)));
    const totalMmr = users.reduce((sum, u) => sum + u.mmr, 0);
    return Math.round(totalMmr / players.length);
}

export function refreshPlayerInactivity(client: Client, room: ActiveRoom, discordId: string) {
    if (!room.playerTimers) room.playerTimers = {};
    const timers = room.playerTimers[discordId];

    if (timers) {
        clearTimeout(timers.warn);
        clearTimeout(timers.kick);
    }

    const warnTime = 5 * 60 * 1000;
    const kickTime = 6 * 60 * 1000;

    room.playerTimers[discordId] = {
        warn: setTimeout(async () => {
            try {
                const channel = await client.channels.fetch(room.roomId);
                if (channel?.isTextBased()) {
                    await (channel as any).send(`⚠️ <@${discordId}>, you have been inactive for 5 minutes. Please type something in **1 minute** or you will be kicked from the queue.`);
                }
            } catch(e) {}
        }, warnTime),
        kick: setTimeout(async () => {
            handleInactivityKick(client, room, discordId);
        }, kickTime)
    };
}

async function handleInactivityKick(client: Client, room: ActiveRoom, discordId: string) {
    if (!room.players.includes(discordId)) return;

    room.players = room.players.filter(id => id !== discordId);
    room.averageMmr = await calculateRoomAverageMmr(room.players);
    delete room.playerTimers[discordId];

    try {
        const channel = await client.channels.fetch(room.roomId);
        if (channel?.isTextBased()) {
            await (channel as any).send(`👢 <@${discordId}> has been kicked from the lobby due to inactivity.`);
            if (channel.isThread()) {
                try { await (channel as any).members.remove(discordId); } catch(e) {}
            }
        }

        // If host was kicked, assign new host
        if (room.hostId === discordId && room.players.length > 0) {
            room.hostId = room.players[0];
            if (channel?.isTextBased()) await (channel as any).send(`👑 <@${room.hostId}> is now the lobby host.`);
        }

        // If empty, close
        if (room.players.length === 0) {
            activeRooms.delete(room.roomId);
            if (channel?.isTextBased() && (channel as any).isThread()) {
                await (channel as any).send("🧹 Lobby empty. Closing.");
                await (channel as any).setArchived(true);
            }
        }
        
        await updateRoomStatusDisplay(client, (channel as any)?.guildId);
    } catch(e) {}
}

export function stopAllPlayerTimers(room: ActiveRoom) {
    if (!room.playerTimers) return;
    for (const timers of Object.values(room.playerTimers)) {
        clearTimeout(timers.warn);
        clearTimeout(timers.kick);
    }
    room.playerTimers = {};
}
