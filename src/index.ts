import { Elysia } from "elysia";
import { Client, GatewayIntentBits, Events, REST, Routes, Partials, MessageFlags } from "discord.js";
import { initDB } from "./db/database";
import { loadSekaiData } from "./api/pjsk";
import { globalCommands, guildCommands, handleCommand, handlePrefixSubmit } from "./commands";
import { updateRoomStatusDisplay, activeRooms, refreshPlayerInactivity } from "./logic/matchmaking";
import { syncAllGuildMembers } from "./logic/roles";

// 1. Initialize Bot Data
await initDB();

// Discord Bot Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.DirectMessages, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel],
});

const token = process.env.DISCORD_TOKEN;
const rest = new REST({ version: "10" }).setToken(token!);

client.once(Events.ClientReady, async (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  
  // Load heavy data into memory on bot start
  await loadSekaiData();

  const guildId = process.env.GUILD_ID;

  try {
    // 1. Register Global Commands
    await rest.put(Routes.applicationCommands(c.user.id), { body: globalCommands });
    console.log("Registered Global commands (Available in DMs).");

    // 2. Initialize Matchmaking for your server
    if (guildId) {
      const guild = await c.guilds.fetch(guildId);
      
      // Register Guild Commands
      await rest.put(Routes.applicationGuildCommands(c.user.id, guildId), { body: guildCommands });
      console.log(`Registered Guild commands for: ${guild.name}`);

      console.log(`Setting up matchmaking for: ${guild.name}`);
      await updateRoomStatusDisplay(c, guildId);
      
      // Global Role Sync
      await syncAllGuildMembers(guild);
    }
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() || interaction.isButton()) {
      await handleCommand(interaction);
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
    if (interaction.isRepliable()) {
        try {
            await interaction.reply({ content: 'An unexpected error occurred while executing this command.', flags: [MessageFlags.Ephemeral] });
        } catch(e) {}
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    // 1. Check for !submit logic
    if (message.content.toLowerCase().startsWith("!submit")) {
      return handlePrefixSubmit(message);
    }

    // 2. Refresh Player Inactivity Timer for any text
    const room = activeRooms.get(message.channelId);
    if (room && room.players.includes(message.author.id)) {
        refreshPlayerInactivity(client, room, message.author.id);
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
});

client.login(token);

// Elysia server
const app = new Elysia()
  .get("/", () => ({
    status: "online",
    bot: client.user?.tag || "Offline",
    ping: client.ws.ping
  }))
  .listen(process.env.PORT || 7860);

console.log(
  `🦊 Web server running at ${app.server?.hostname}:${app.server?.port}`
);
