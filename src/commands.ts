import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextChannel,
  AttachmentBuilder,
  Interaction,
  ChannelType,
} from "discord.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { join } from "node:path";
import {
  activeRooms,
  ActiveRoom,
  generateRoomMatchmaking,
  calculateScore,
  calculateAccuracy,
  updateRoomStatusDisplay,
  calculateRoomAverageMmr,
  refreshPlayerInactivity,
  stopAllPlayerTimers,
  getRankName,
} from "./logic/matchmaking";
import { calculateExpectedNotes } from "./api/pjsk";
import { finalizeMatch } from "./logic/results";
import {
  getUser,
  getTopPlayers,
  getMmrCutoffs,
  getLeaderboardPosition,
  getUserMatchHistory,
  getCurrentSeason,
  setCurrentSeason,
  resetSeason,
} from "./db/database";

export const globalCommands = [
  new SlashCommandBuilder()
    .setName("hello")
    .setDescription("Greet another person")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to greet").setRequired(true),
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),
  new SlashCommandBuilder()
    .setName("slap")
    .setDescription("Slap someone you want!")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to slap").setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("The reason for the slap"),
    )
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2]),
].map((c) => c.toJSON());

export const guildCommands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join the active matchmaking lobby in this channel"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the active matchmaking lobby"),
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Start a match with the current lobby"),
  new SlashCommandBuilder()
    .setName("top10")
    .setDescription("View the top 10 global leaderboard"),
  new SlashCommandBuilder()
    .setName("top100")
    .setDescription("View the global top 100 players"),
  new SlashCommandBuilder()
    .setName("cutoff")
    .setDescription("View the MMR cutoffs for top leaderboard positions"),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View detailed tournament statistics")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to view stats for"),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("season")
        .setDescription("Season number (default current)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("mmr")
    .setDescription("View current MMR and Rank")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to view MMR for"),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("season")
        .setDescription("Season number (default current)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("forfeit")
    .setDescription("Start a vote to forfeit the current match"),
  new SlashCommandBuilder()
    .setName("season")
    .setDescription("Seasonal system management")
    .addSubcommand((sub) =>
      sub.setName("info").setDescription("View current season information"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("reset")
        .setDescription("Reset the current season (Admin Only)"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Manually set the current season number (Admin Only)")
        .addIntegerOption((opt) =>
          opt
            .setName("number")
            .setDescription("The season number to set")
            .setRequired(true),
        ),
    ),
].map((c) => c.toJSON());

function getThreadLabel(
  guildId: string | null,
  roomId: string,
  roomName?: string,
): string {
  const name = roomName || `room-${roomId.slice(-4)}`;
  return `**${name}**`;
}

const joinLocks = new Map<string, Promise<void>>();

async function withJoinLock<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const tail = joinLocks.get(key) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = tail.then(() => gate);
  joinLocks.set(key, queued);

  await tail;
  try {
    return await action();
  } finally {
    release?.();
    if (joinLocks.get(key) === queued) {
      joinLocks.delete(key);
    }
  }
}

// The command handler
export async function handleCommand(interaction: Interaction) {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // Auto-unarchive thread if command is used in one
  if (interaction.channel?.isThread() && interaction.channel.archived) {
    try {
      await interaction.channel.setArchived(false);
    } catch (e) {}
  }

  // Handle Button Interactions
  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId === "agree_forfeit") {
      const room = activeRooms.get(interaction.channelId!);
      const userId = interaction.user.id;

      if (!room || room.status !== "playing") {
        return interaction.reply({
          content: "❌ No active match to forfeit.",
          flags: [MessageFlags.Ephemeral],
        });
      }
      if (!room.players.includes(userId)) {
        return interaction.reply({
          content: "❌ You are not in this match.",
          flags: [MessageFlags.Ephemeral],
        });
      }
      if (room.forfeitVotes.includes(userId)) {
        return interaction.reply({
          content: "❌ You already agreed.",
          flags: [MessageFlags.Ephemeral],
        });
      }

      room.forfeitVotes.push(userId);

      if (room.forfeitVotes.length >= room.players.length) {
        // Immediately clean up the room so players can rejoin
        stopAllPlayerTimers(room);
        activeRooms.delete(room.roomId);
        await updateRoomStatusDisplay(
          interaction.client,
          interaction.guildId!,
        ).catch(console.error);

        await interaction.reply(
          "🏁 **Consensus Reached!** All players agreed to forfeit. Closing room in 5 seconds...",
        );
        setTimeout(async () => {
          try {
            await (interaction.channel as any)?.delete();
          } catch (e) {}
        }, 5000);
        return;
      } else {
        const embed = new EmbedBuilder()
          .setTitle("🏁 FORFEIT VOTE IN PROGRESS")
          .setDescription(
            `**${room.forfeitVotes.length}/${room.players.length}** players have agreed to forfeit.\n\n*Waiting for everyone to click "Agree" to cancel the match...*`,
          )
          .setColor("#FF3399");

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("agree_forfeit")
            .setLabel(
              `Agree (${room.forfeitVotes.length}/${room.players.length})`,
            )
            .setStyle(ButtonStyle.Danger),
        );

        return interaction.update({ embeds: [embed], components: [row] });
      }
    }
    return;
  }

  // Slash Commands only from here
  if (!interaction.isChatInputCommand()) return;
  const { commandName, channelId, user } = interaction;

  const guildId = interaction.guildId;
  const adminGuildId = process.env.GUILD_ID;

  // List of commands restricted to the official competition server
  const competitiveCommands = [
    "join",
    "leave",
    "start",
    "top10",
    "top100",
    "cutoff",
    "stats",
    "mmr",
    "forfeit",
    "season",
  ];

  if (competitiveCommands.includes(commandName)) {
    if (guildId !== adminGuildId) {
      return interaction.reply({
        content:
          "❌ This is a competitive tournament command and can only be used in the official SEKAIBOT server.",
        flags: [MessageFlags.Ephemeral],
      });
    }
  }

  if (commandName === "join") {
    const channelName = (interaction.channel as TextChannel)?.name;
    const targetRegion: "EN" | "JP" = channelName === "jp-join" ? "JP" : "EN";
    const lockKey = `${interaction.guildId ?? "dm"}:${targetRegion}`;

    return withJoinLock(lockKey, async () => {
      if (channelName !== "join" && channelName !== "jp-join") {
        return interaction.reply({
          content:
            "❌ You can only use this command in the `#join` or `#jp-join` channel.",
          flags: [MessageFlags.Ephemeral],
        });
      }

      // Global duplicate check: prevent joining if you're already in ANY room
      for (const room of activeRooms.values()) {
        if (room.players.includes(user.id)) {
          const roomLink = getThreadLabel(
            interaction.guildId,
            room.roomId,
            room.roomName,
          );
          return interaction.reply({
            content: `❌ You are already in an active room: ${roomLink}. Please /leave or finish that match first.`,
            flags: [MessageFlags.Ephemeral],
          });
        }
      }

      let targetRoom: ActiveRoom | undefined;
      // Find an open room
      for (const room of activeRooms.values()) {
        if (
          room.status === "open" &&
          room.region === targetRegion &&
          room.players.length < 5
        ) {
          targetRoom = room;
          break;
        }
      }

      if (targetRoom) {
        if (targetRoom.players.includes(user.id)) {
          return interaction.reply({
            content: "You are already in an active queue.",
            flags: [MessageFlags.Ephemeral],
          });
        }
        targetRoom.players.push(user.id);
        targetRoom.averageMmr = await calculateRoomAverageMmr(
          targetRoom.players,
        );
        const u = await getUser(user.id);

        // Add user to thread
        try {
          const thread = await interaction.client.channels.fetch(
            targetRoom.roomId,
          );
          if (thread?.isThread()) {
            targetRoom.roomName = thread.name;
            await thread.members.add(user.id);
          }
        } catch (e) {}

        const roomLink = getThreadLabel(
          interaction.guildId,
          targetRoom.roomId,
          targetRoom.roomName,
        );
        await interaction.reply({
          content: `🏁 <@${user.id}> joined the queue! MMR: ${u.mmr} [${getRankName(u.mmr, u.is_ranked)}] (${targetRoom.players.length}/5).\n👉 Head over to ${roomLink}!`,
        });
        refreshPlayerInactivity(interaction.client, targetRoom, user.id);
        return updateRoomStatusDisplay(
          interaction.client,
          interaction.guildId!,
        ).catch(console.error);
      }

      // Create new room thread
      const textChannel = interaction.channel as TextChannel;
      const roomNumber = activeRooms.size + 1;

      try {
        const thread = await textChannel.threads.create({
          name: `room-${roomNumber}`,
          autoArchiveDuration: 60,
          type: ChannelType.PrivateThread,
          reason: "Matchmaking lobby",
        });

        await thread.members.add(user.id);

        const newRoom: ActiveRoom = {
          roomId: thread.id,
          roomName: thread.name,
          hostId: user.id,
          players: [user.id],
          status: "open",
          averageMmr: await calculateRoomAverageMmr([user.id]),
          songs: [],
          expectedTotalNotes: 0,
          submissions: {},
          playerTimers: {},
          forfeitVotes: [],
          region: targetRegion,
        };
        activeRooms.set(thread.id, newRoom);

        const u = await getUser(user.id);
        const roomLink = getThreadLabel(
          interaction.guildId,
          thread.id,
          thread.name,
        );
        await interaction.reply({
          content: `🏁 <@${user.id}> created a new queue! MMR: ${u.mmr} [${getRankName(u.mmr, u.is_ranked)}] (1/5).\n👉 Head over to ${roomLink}!`,
        });
        refreshPlayerInactivity(interaction.client, newRoom, user.id);
        return updateRoomStatusDisplay(
          interaction.client,
          interaction.guildId!,
        ).catch(console.error);
      } catch (e) {
        console.error("Failed to create thread:", e);
        return interaction.reply({
          content:
            "Failed to create a room thread. Does the bot have 'Create Public Threads' permission?",
          flags: [MessageFlags.Ephemeral],
        });
      }
    });
  }

  if (commandName === "leave") {
    // 1. Check if we are currently inside an active room thread first
    let targetRoom = activeRooms.get(channelId);

    // 2. If not in the current channel, search globally across all rooms
    if (!targetRoom) {
      for (const room of activeRooms.values()) {
        if (room.players.includes(user.id)) {
          targetRoom = room;
          break;
        }
      }
    }

    if (!targetRoom || !targetRoom.players.includes(user.id)) {
      return interaction.reply({
        content: "❌ You are not in any active matchmaking queue.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (targetRoom.status !== "open") {
      return interaction.reply({
        content:
          "❌ You cannot leave a match that is already in progress. Please finish the match or forfeit.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    targetRoom.players = targetRoom.players.filter((id) => id !== user.id);
    targetRoom.averageMmr = await calculateRoomAverageMmr(targetRoom.players);

    // Clear the leaving player's inactivity timer immediately
    if (targetRoom.playerTimers?.[user.id]) {
      clearTimeout(targetRoom.playerTimers[user.id].warn);
      clearTimeout(targetRoom.playerTimers[user.id].kick);
      delete targetRoom.playerTimers[user.id];
    }

    // Remove from thread
    try {
      const thread = await interaction.client.channels.fetch(targetRoom.roomId);
      if (thread?.isThread()) await thread.members.remove(user.id);
    } catch (e) {}

    if (targetRoom.players.length === 0) {
      // Stop ALL remaining timers to prevent ghost warnings
      stopAllPlayerTimers(targetRoom);

      await interaction.reply(
        `🏃‍♂️ <@${user.id}> left the lobby. Since it's empty, the room thread has been closed.`,
      );
      activeRooms.delete(targetRoom.roomId);

      // Update the board first
      await updateRoomStatusDisplay(
        interaction.client,
        interaction.guildId!,
      ).catch(console.error);

      // Archive thread
      try {
        const thread = await interaction.client.channels.fetch(
          targetRoom.roomId,
        );
        if (thread?.isThread()) {
          await thread.send("Room lobby is now empty. Archiving.");
          await thread.setArchived(true);
        }
      } catch (e) {
        console.error("Failed to archive empty thread:", e);
      }

      return;
    }

    const roomLink = getThreadLabel(
      interaction.guildId,
      targetRoom.roomId,
      targetRoom.roomName,
    );
    await interaction.reply({
      content: `🏃‍♂️ <@${user.id}> left the queue inside ${roomLink}. (${targetRoom.players.length}/5)`,
      flags: [MessageFlags.Ephemeral],
    });
    return updateRoomStatusDisplay(
      interaction.client,
      interaction.guildId!,
    ).catch(console.error);
  }

  if (commandName === "start") {
    const room = activeRooms.get(channelId);
    if (!room || room.status !== "open") {
      return interaction.reply({
        content:
          "❌ You must run this inside an active Bot Thread (`#room-X`).",
        flags: [MessageFlags.Ephemeral],
      });
    }
    if (room.hostId !== user.id) {
      return interaction.reply({
        content: "❌ Only the host can start the match.",
        flags: [MessageFlags.Ephemeral],
      });
    }
    if (room.players.length < 2) {
      return interaction.reply({
        content: "❌ You need at least 2 players to start a competitive match.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    // Generate match based on MMR
    const matchInfo = await generateRoomMatchmaking(room.players, room.region);

    if (!matchInfo.success) {
      return interaction.reply({
        content: `❌ Matchmaking Failed: ${matchInfo.error}`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    room.status = "playing";
    room.averageMmr = matchInfo.averageMmr!;
    room.songs = matchInfo.songs!;
    room.expectedTotalNotes = calculateExpectedNotes(room.songs);

    // Build Game Room Dashboard
    const embed = new EmbedBuilder()
      .setTitle(`🎮 Set Dashboard - Average Room MMR: ${room.averageMmr}`)
      .setDescription(
        `**Level Range generated based on room skill.**\n\n**The Setlist:**\n` +
          room.songs
            .map(
              (s, i) =>
                `${i + 1}. **${s.music.title}** [${s.difficulty.musicDifficulty.toUpperCase()} - Lv ${s.difficulty.playLevel}] - **${s.difficulty.totalNoteCount} notes**`,
            )
            .join("\n"),
      )
      .setColor("#FF00FF")
      .addFields({
        name: "⚠️ MATCH VALIDATION ⚠️",
        value: `**EXPECTED TOTAL NOTES: ${room.expectedTotalNotes}**\n*(Input exactly this sum when submitting!)*`,
      });

    await interaction.reply({
      content: `Match Started! Players, good luck. Host, please use \`!submit\` in this thread when done.`,
      embeds: [embed],
    });
    refreshPlayerInactivity(interaction.client, room, user.id);
    return updateRoomStatusDisplay(
      interaction.client,
      interaction.guildId!,
    ).catch(console.error);
  }

  if (commandName === "top10") {
    const top10 = await getTopPlayers(10, 0);
    const embed = new EmbedBuilder()
      .setTitle("🏆 Global Top 10 Leaderboard")
      .setColor("#FFD700");

    let desc = "";
    top10.forEach((u, i) => {
      const rank = getRankName(u.mmr, u.is_ranked);
      desc += `${i + 1}. <@${u.discord_id}> [${rank}] - **${u.mmr} MMR**\n`;
    });
    embed.setDescription(desc || "No players ranked yet.");

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === "top100") {
    const top100 = await getTopPlayers(100, 0);
    const embed = new EmbedBuilder()
      .setTitle("🏆 Global Top 100 Leaderboard")
      .setColor("#C0C0C0");

    let desc = "";
    top100.slice(0, 20).forEach((u, i) => {
      // show first 20 for brevity or pagination
      const rank = getRankName(u.mmr, u.is_ranked);
      desc += `${i + 1}. <@${u.discord_id}> [${rank}] - **${u.mmr} MMR**\n`;
    });
    if (top100.length > 20)
      desc += `...and ${top100.length - 20} more players.`;
    embed.setDescription(desc || "No players ranked yet.");

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === "mmr") {
    const target = interaction.options.getUser("user") || user;
    const seasonParam = interaction.options.getInteger("season");
    const seasonId = seasonParam ?? (await getCurrentSeason());
    const u = await getUser(target.id);
    const rank = getRankName(u.mmr, u.is_ranked);

    const embed = new EmbedBuilder()
      .setTitle(`📊 MMR Profile (Season ${seasonId}): ${target.username}`)
      .setColor("#3B82F6")
      .addFields(
        { name: "Current MMR", value: `**${u.mmr}**`, inline: true },
        { name: "Current Rank", value: `**${rank}**`, inline: true },
        { name: "Season", value: `**${seasonId}**`, inline: true },
      );
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === "cutoff") {
    const cutoffs = await getMmrCutoffs();
    const embed = new EmbedBuilder()
      .setTitle("🏁 Global Leaderboard Cutoffs")
      .setColor("#FBBF24")
      .setDescription("Thresholds required to enter top positions:")
      .addFields(
        { name: "Top 10", value: `${cutoffs.top10} MMR`, inline: true },
        { name: "Top 20", value: `${cutoffs.top20} MMR`, inline: true },
        { name: "Top 50", value: `${cutoffs.top50} MMR`, inline: true },
        { name: "Top 100", value: `${cutoffs.top100} MMR`, inline: true },
      );
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === "stats") {
    const target = interaction.options.getUser("user") || user;
    const seasonParam = interaction.options.getInteger("season");
    const seasonId = seasonParam ?? (await getCurrentSeason());
    const u = await getUser(target.id);
    const pos = await getLeaderboardPosition(target.id);
    const history = (await getUserMatchHistory(target.id, 10)) as {
      is_placement: boolean;
      is_win: boolean;
      mmr_change: number;
    }[];

    const rankedHistory = history.filter((h) => !h.is_placement);
    const last10Wins = rankedHistory.filter((h) => h.is_win).length;
    const last10Losses = rankedHistory.length - last10Wins;

    // Sum MMR changes for NON-PLACEMENT matches to show true performance trend
    const last10MmrChange = rankedHistory.reduce(
      (sum, h) => sum + h.mmr_change,
      0,
    );
    const sign = last10MmrChange >= 0 ? "+" : "";

    const embed = new EmbedBuilder()
      .setTitle(`📜 Tournament Record (Season ${seasonId}): ${target.username}`)
      .setColor("#8B5CF6")
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        {
          name: "Rank & Position",
          value: `[${getRankName(u.mmr, u.is_ranked)}] - **#${pos}**`,
          inline: false,
        },
        {
          name: "MMR Stats",
          value: `Current: **${u.mmr}**\nPeak: **${u.peak_mmr}**`,
          inline: true,
        },
        {
          name: "Total Record",
          value: `Played: ${u.total_matches}\nRecord: ${u.wins}W - ${u.losses}L`,
          inline: true,
        },
        {
          name: "Last 10 Matches",
          value: `Record: ${last10Wins}W - ${last10Losses}L\nPerformance: **${sign}${last10MmrChange} MMR**`,
          inline: false,
        },
        { name: "Season", value: `**${seasonId}**`, inline: true },
      );

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === "forfeit") {
    const room = activeRooms.get(channelId);
    if (!room || room.status !== "playing") {
      return interaction.reply({
        content: "❌ You can only forfeit during an active playing match.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("🏁 FORFEIT VOTE INITIATED")
      .setDescription(
        `**${user.username}** wants to forfeit this match.\n\n**All participants must click "Agree" to cancel the match.**\n(Progress: ${room.forfeitVotes.length}/${room.players.length})`,
      )
      .setColor("#FF3399");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("agree_forfeit")
        .setLabel("Agree")
        .setStyle(ButtonStyle.Danger),
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  if (commandName === "hello") {
    const target = interaction.options.getUser("user");
    return interaction.reply(
      `Hello <@${target?.id}>! I hope you're having a wonderful day! MIKU MIKU BEAM!`,
    );
  }

  if (commandName === "slap") {
    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const sender = interaction.user;

    try {
      const imagePath = join(process.cwd(), "public", "slap.png");
      console.log(`[DEBUG] Slap Image Path: ${imagePath}`);

      const img = await loadImage(imagePath);
      console.log("[DEBUG] Slap Image loaded successfully.");
      const height = 170;
      const width = (img.width / img.height) * height;

      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const buffer = canvas.toBuffer("image/png");
      const attachment = new AttachmentBuilder(buffer, { name: "slap.png" });

      let content = `**<@${sender.id}> slapped <@${target?.id}>!**`;
      if (reason) content += `\n**Reason:** ${reason}`;

      return interaction.reply({ content, files: [attachment] });
    } catch (e) {
      console.error("[ERROR] Failed to load slap image:", e);
      let content = `**<@${sender.id}> slapped <@${target?.id}>!**`;
      if (reason) content += `\n**Reason:** ${reason}`;
      return interaction.reply({ content, ephemeral: false });
    }
  }

  if (commandName === "season") {
    const sub = interaction.options.getSubcommand();
    const isAdmin = (interaction.member as any)?.permissions.has(
      "Administrator",
    );
    const seasonId = await getCurrentSeason();

    if (sub === "info") {
      const embed = new EmbedBuilder()
        .setTitle("📅 Seasonal Information")
        .setColor("#3B82F6")
        .setDescription(`The bot is currently in **Season ${seasonId}**.`)
        .addFields({
          name: "Season Reset Logic",
          value:
            "• Players who played this season: **-50 MMR**\n• Players with **900+ MMR**: Reset to **800**\n• Peak MMR is also reset to the new seasonal MMR.\n• Inactive players are unaffected.",
        });
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === "reset") {
      if (!isAdmin)
        return interaction.reply({
          content: "❌ Only administrators can reset the season.",
          flags: [MessageFlags.Ephemeral],
        });

      const result = await resetSeason();
      const embed = new EmbedBuilder()
        .setTitle("🔄 Season Reset Successful")
        .setColor("#10B981")
        .setDescription(
          `**Season ${result.oldSeason}** has ended. **Season ${result.newSeason}** has officially begun!`,
        )
        .addFields({
          name: "Affected Players",
          value: `${result.affectedPlayers} players who participated in Season ${result.oldSeason} had their MMR/Peak MMR adjusted.`,
          inline: false,
        })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === "start") {
      if (!isAdmin)
        return interaction.reply({
          content: "❌ Only administrators can change the season number.",
          flags: [MessageFlags.Ephemeral],
        });
      const newSeasonId = interaction.options.getInteger("number")!;
      await setCurrentSeason(newSeasonId);
      return interaction.reply(
        `✅ Current season manually set to **Season ${newSeasonId}**.`,
      );
    }
  }
}

import { Message } from "discord.js";

// Handle !submit prefix command
export async function handlePrefixSubmit(message: Message) {
  const channelId = message.channelId;
  const room = activeRooms.get(channelId);

  if (!room || room.status !== "playing") {
    return message.reply("❌ There is no active playing match in this thread.");
  }

  if (message.author.id !== room.hostId) {
    return message.reply("❌ Only the match host can use `!submit`.");
  }

  // Split message by lines. Ignore first line if it's strictly "!submit"
  const lines = message.content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l.toLowerCase() !== "!submit");

  if (lines.length !== room.players.length) {
    return message.reply(
      `❌ Expected ${room.players.length} result lines, but got ${lines.length}.`,
    );
  }

  const regex =
    /<@!?(\d+)>.*?\[(.*?)\]\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/;

  // We will parse all lines FIRST before mutating state
  const parseResults = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(regex);
    if (!match) {
      return message.reply(
        `❌ Syntax error on line ${i + 1}:\n\`${line}\`\nExpected format: \`<@user> [Region] Perfect,Great,Good,Bad,Miss\``,
      );
    }

    const discordId = match[1];
    const region = match[2].toUpperCase();
    if (!room.players.includes(discordId)) {
      return message.reply(`❌ User <@${discordId}> is not in this match.`);
    }

    const p = parseInt(match[3]);
    const g = parseInt(match[4]);
    const go = parseInt(match[5]);
    const b = parseInt(match[6]);
    const m = parseInt(match[7]);

    const totalInput = p + g + go + b + m;

    if (totalInput !== room.expectedTotalNotes) {
      return message.reply(
        `❌ **Validation Failed on line ${i + 1} (<@${discordId}>)!**\nYou counted **${totalInput}** total notes, but the set has exactly **${room.expectedTotalNotes}** notes.\nPlease double check the count.`,
      );
    }

    const accuracy = calculateAccuracy(p, g, go, b, m, room.expectedTotalNotes);
    const score = calculateScore(p, g, go, b, m);

    parseResults.push({ discordId, p, g, go, b, m, accuracy, score, region });
  }

  // Since parsing succeeded, apply them all
  for (const res of parseResults) {
    let attachmentUrl = undefined;
    if (message.attachments.size > 0)
      attachmentUrl = message.attachments.first()?.url;

    room.submissions[res.discordId] = {
      perfects: res.p,
      greats: res.g,
      goods: res.go,
      bads: res.b,
      misses: res.m,
      accuracy: res.accuracy,
      score: res.score,
      region: res.region,
      attachmentUrl,
    };
  }

  await message.reply(
    "✅ All 5 player results perfectly validated! Finalizing Match...",
  );

  // Auto trigger finalize
  await finalizeMatch(room, message.channel as TextChannel);
}
