import { Guild} from "discord.js";
import { getUser } from "../db/database";
import { getRankName } from "./matchmaking";

// All ranks
const RANK_ROLE_NAMES = [
    "Legend", "Divine Star", "Star", "Grand Champion", "Champion", 
    "Master up", "Master", "Crystal up", "Crystal", "Diamond up", "Diamond", 
    "Platinum up", "Platinum", "Gold up", "Gold", "Silver up", "Silver", 
    "Bronze up", "Bronze", "Iron up", "Iron", "Placement"
];

/**
 * Synchronizes a single user's Discord role with their current MMR rank
 */
export async function syncUserRole(guild: Guild, discordId: string) {
    try {
        const member = await guild.members.fetch(discordId);
        if (!member) return;

        const u = await getUser(discordId);
        const currentRankName = getRankName(u.mmr, u.is_ranked);
        
        // 1. Find the target role by name
        const targetRole = guild.roles.cache.find(r => r.name === currentRankName);
        if (!targetRole) {
            console.warn(`Role "${currentRankName}" not found in guild "${guild.name}".`);
            return;
        }

        // 2. Identify all other rank roles the user currently has
        const otherRankRoles = member.roles.cache.filter(role => 
            RANK_ROLE_NAMES.includes(role.name) && role.name !== currentRankName
        );

        // 3. Update roles: Remove others, add target
        if (otherRankRoles.size > 0) {
            await member.roles.remove(otherRankRoles);
        }

        if (!member.roles.cache.has(targetRole.id)) {
            await member.roles.add(targetRole);
        }
    } catch (e) {
        console.error(`Failed to sync role for user ${discordId}:`, e);
    }
}

/**
 * Sweeps the entire server and ensures everyone has at least the "Placement" role
 * or their correct MMR rank.
 */
export async function syncAllGuildMembers(guild: Guild) {
    console.log(`Starting global role sync for guild: ${guild.name}...`);
    try {
        const members = await guild.members.fetch();
        for (const [id, member] of members) {
            if (member.user.bot) continue;
            await syncUserRole(guild, id);
        }
        console.log(`Global role sync completed for ${members.size} members.`);
    } catch (e) {
        console.error("Failed to perform global role sync:", e);
    }
}
