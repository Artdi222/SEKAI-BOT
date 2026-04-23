# SEKAI BOT - Project Sekai Competition Logic

"SEKAI BOT" is a professional competition automation bot for Discord. It prioritizes clean aesthetics, clear feedback, and a competitive rhythm-game atmosphere.

---

## Installation & Setup Guide

This project is built using **[Bun](https://bun.sh/)**, a fast all-in-one JavaScript runtime. You will need to install it to run the bot efficiently.

### 1. Install Bun
Since not everyone uses Bun by default, here is how to quickly install it on your system:

**Windows (PowerShell):**
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

**macOS / Linux / WSL:**
```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Clone and Setup
Once Bun is installed, follow these steps to set up the bot on your PC:

1. **Clone the repository** to your local machine.
2. **Install dependencies** using Bun:
   ```bash
   bun install
   ```
3. **Configure the Environment Variables**:
   Create a `.env` file in the root directory (you can copy `.env.example` if it exists) and fill in your details:
   ```env
   DISCORD_TOKEN=your_bot_token_here
   GUILD_ID=your_main_server_id
   ```
4. **Run the Bot**:
   During development:
   ```bash
   bun run dev
   ```
   For production:
   ```bash
   bun start
   ```

---

## User Interaction Flow

### 1. Matchmaking `/join` & `/leave`
- Players type `/join` in `#join` (EN) or `#jp-join` (JP) channels to enter the queue.
- The bot groups up to 5 players per region into private server threads (`#room-X`). Use `/leave` to detach before the room starts.

### 2. Match Initialization (`/start`) & Tier Lock Check
The Room Host must run `/start` to begin the game. Before generating a match, the bot enforces a **strict 400 MMR cap variance**:
- **On Failure**: "The skill gap in this room is too high for a fair match (Difference > 400 MMR)."
- **On Success**: The bot delivers a **Set Dashboard**.
  - **Match Metadata**: Displays Expected Total Notes and the generated Setlist with expected difficulty levels (Lv 23 - 38 depending on lobby average).

### 3. Submission Flow (`!submit`)
- **UI**: The lobby Host triggers the match upload modal with `!submit`.
- **Validation Check**: If the total sum of `P/G/G/B/M` notes does not perfectly equal the `Expected Total Notes`, the bot rejects the submission automatically to prevent tampering.

### 4. Forfeit Voting (`/forfeit`)
- Any player can type `/forfeit` mid-match if issues arise.
- **Democratic Cancel**: A confirmation prompt creates a voting button. Only when **all** participants click "Agree" does the bot instantly close and wipe the lobby stats.

### 5. Result Visualization (#results)
- Once submitted, the bot auto-cleans the lobby thread by systematically archiving it after 30 seconds.
- Results post directly into `#results` or `#jp-results` including:
  - **Setlist Analytics**: Identifies what songs were played and their total note loads.
  - **Dynamic MMR Engine**: Shows EXACT ELO distributions. (`+28 MMR` for 1st place wins, `Placement` matches tracked exclusively).
  - **Result Image Generation**: A generated webp profile board using `@napi-rs/canvas`.

### Seasonal System
The competitive ladder operates on monthly seasons.

#### MMR Reset Logic
At the end of each season, players who participated (played at least one match) will have their MMR adjusted:
- **Participation Adjustment**: Players receive a **-50 MMR** penalty.
- **Master Cap**: Players with **900+ MMR** are reset to **800 MMR** (Champion rank).
- **Peak MMR Reset**: Peak MMR is reset to the new starting MMR for the new season.
- **Inactivity Protection**: Players who did not play during the season are **not** penalized and retain their MMR.

#### Admin Commands
- **/season info**: View current season and reset rules.
- **/season reset**: Manually end the current season and apply MMR adjustments.
- **/season start <number>**: Manually set the current season number.

---

## Command Reference

Sekai Bot is divided into **Competitive Commands** (which only work in the official tournament server) and **Global Social Commands** (which can be used anywhere or in DMs).

### Competitive Commands (Server Only)
*   **`/join`**: Join the matchmaking lobby. Must be used inside the designated `#join` (EN) or `#jp-join` (JP) channels.
*   **`/leave`**: Leave the matchmaking queue if you haven't started a match yet.
*   **`/start`**: Generates the match setlist and begins the game. Can only be used by the Lobby Host inside the lobby thread (`#room-X`).
*   **`!submit`**: Triggers the submission modal for the game. This is a prefix command (!), not a slash command, and must be typed by the Lobby Host at the end of the match.
*   **`/forfeit`**: Initiates a consensus vote to cancel an active match. All players in the lobby must click "Agree" for the match to be safely voided.
*   **`/stats [user]`**: Displays a comprehensive player profile, including Peak MMR, Win/Loss ratio (Wins = 1st place finishes), and recent Match History (dynamically ignores placement rounds from trend calculations).
*   **`/mmr [user]`**: A quick command to check a player's current MMR and Rank Title.
*   **`/top10`**: Displays the Top 10 highest ranking players currently on the server.
*   **`/top100`**: Shows an extended, paginated list of the Top 100 players.
*   **`/cutoff`**: Displays the exact MMR required to reach the Top 10, Top 50, and Top 100 thresholds.

### Global Commands
*   **`/hello <user>`**: A fun command to greet another player ("MIKU MIKU BEAM!"). Works everywhere, including DMs!
*   **`/slap <user> [reason]`**: Generate a custom image of you slapping another user! Works everywhere, including DMs!

---

## Internal System Logic (Documentation)

### 1. Matchmaking Levels

The bot picks 5 songs based on the Average MMR of the lobby:
| MMR Range | Average Room Rank equivalent | Base Level Range | Append Range |
| :--- | :--- | :--- | :--- |
| **0 - 99** | Iron | 23 - 26 | *(N/A)* |
| **100 - 249** | Bronze, Silver | 26 - 28 | *(N/A)* |
| **250 - 399** | Silver Up, Gold | 28 - 30 | *(N/A)* |
| **400 - 599** | Platinum, Diamond | 30 - 31 | *(N/A)* |
| **600 - 649** | Crystal | 30 - 31 | 25 - 28 |
| **650 - 699** | Crystal Up | 30 - 32 | 26 - 29 |
| **700 - 749** | Master | 31 - 33 | 27 - 30 |
| **750 - 799** | Master Up | 31 - 33 | 29 - 31 |
| **800 - 849** | Champion | 32 - 34 | 31 - 33 |
| **850 - 999** | Grand Champion, Star | 33 - 36 | 33 - 37 |
| **1000+** | Legend | 34 - 37 | 35 - 38 |

### 2. Point Weighting

- **PERFECT**: 4 | **GREAT**: 3 | **GOOD**: 2 | **BAD**: 1 | **MISS**: 0

### 3. Great Equivalent (GE) Conversion (Matches/Placement)
Used for determining initial placement rank:
- **1 GREAT** = 1 GE
- **1 GOOD** = 2 GE
- **1 BAD** = 3 GE
- **1 MISS** = 4 GE

### 4. Rank Thresholds (Internal Reference)
| Rank | MMR Range | Placement Requirement (Total non-Perfects) |
| :--- | :--- | :--- |
| **Legend** | 1000+ | Need to reach |
| **Divine Star** | 950-999 | Need to reach |
| **Star** | 900-949 | Need to reach |
| **Grand Champion** | 850-899 | Need to reach |
| **Champion** | 800-849 | All Perfect (0 GE) |
| **Master up** | 750-799 | 1-5 GE |
| **Master** | 700-749 | 6-10 GE |
| **Crystal up** | 650-699 | 11-15 GE |
| **Crystal** | 600-649 | 16-25 GE |
| **Diamond up** | 550-599 | 26-40 GE |
| **Diamond** | 500-549 | 41-75 GE |
| **Platinum up** | 450-499 | 76-120 GE |
| **Platinum** | 400-449 | 121-200 GE |
| **Gold up** | 350-399 | 201-350 GE |
| **Gold** | 300-349 | 351-500 GE |
| **Silver up** | 250-299 | 501-800 GE |
| **Silver** | 200-249 | 801-1200 GE |
| **Bronze up** | 150-199 | 1201-1700 GE |
| **Bronze** | 100-149 | 1701-2500 GE |
| **Iron up** | 50-99 | 2501-4000 GE |
| **Iron** | 0-49 | +4000 GE |
