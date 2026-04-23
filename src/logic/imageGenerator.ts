import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface PlayerRow {
    username: string;
    region: string;
    perfects: number;
    greats: number;
    goods: number;
    bads: number;
    misses: number;
    score: number;
    mmrChange: number;
    oldMmr: number;
    newMmr: number;
    isPlacement: boolean;
}

/**
 * Applies a rank-based gradient style to the text
 */
function applyRankStyle(ctx: any, row: PlayerRow, x: number, y: number, text: string) {
    const mmr = row.newMmr;
    const textWidth = ctx.measureText(text).width;
    const grad = ctx.createLinearGradient(x, 0, x + textWidth, 0);

    if (row.isPlacement) {
        grad.addColorStop(0, "#FBBF24"); grad.addColorStop(1, "#D97706");
    } else if (mmr >= 1000) { // Legend
        grad.addColorStop(0, "#d977d9"); grad.addColorStop(1, "#9d78ff");
    } else if (mmr >= 950) { // Divine Star
        grad.addColorStop(0, "#9d78ff"); grad.addColorStop(1, "#7c52ff");
    } else if (mmr >= 900) { // Star
        grad.addColorStop(0, "#6a789a"); grad.addColorStop(1, "#4b5563");
    } else if (mmr >= 850) { // Grand Champion
        grad.addColorStop(0, "#ff4d4d"); grad.addColorStop(1, "#ae3838");
    } else if (mmr >= 800) { // Champion
        grad.addColorStop(0, "#ae3838"); grad.addColorStop(1, "#7f1d1d");
    } else if (mmr >= 750) { // Master up
        grad.addColorStop(0, "#c084fc"); grad.addColorStop(1, "#8c58f6");
    } else if (mmr >= 700) { // Master
        grad.addColorStop(0, "#8c58f6"); grad.addColorStop(1, "#71368a");
    } else if (mmr >= 650) { // Crystal up
        grad.addColorStop(0, "#f472b6"); grad.addColorStop(1, "#bd5bb2");
    } else if (mmr >= 600) { // Crystal
        grad.addColorStop(0, "#bd5bb2"); grad.addColorStop(1, "#ff00ff");
    } else if (mmr >= 550) { // Diamond up
        grad.addColorStop(0, "#7dd3fc"); grad.addColorStop(1, "#4db8ff");
    } else if (mmr >= 500) { // Diamond
        grad.addColorStop(0, "#4db8ff"); grad.addColorStop(1, "#3498db");
    } else if (mmr >= 450) { // Platinum up
        grad.addColorStop(0, "#a5b4fc"); grad.addColorStop(1, "#818cf8");
    } else if (mmr >= 400) { // Platinum
        grad.addColorStop(0, "#818cf8"); grad.addColorStop(1, "#475569");
    } else if (mmr >= 350) { // Gold up
        grad.addColorStop(0, "#fbbf24"); grad.addColorStop(1, "#f59e0b");
    } else if (mmr >= 300) { // Gold
        grad.addColorStop(0, "#f59e0b"); grad.addColorStop(1, "#b45309");
    } else if (mmr >= 250) { // Silver up
        grad.addColorStop(0, "#e2e8f0"); grad.addColorStop(1, "#cbd5e1");
    } else if (mmr >= 200) { // Silver
        grad.addColorStop(0, "#cbd5e1"); grad.addColorStop(1, "#94a3b8");
    } else if (mmr >= 150) { // Bronze up
        grad.addColorStop(0, "#fdba74"); grad.addColorStop(1, "#fb923c");
    } else if (mmr >= 100) { // Bronze
        grad.addColorStop(0, "#fb923c"); grad.addColorStop(1, "#b45309");
    } else if (mmr >= 50) { // Iron up
        grad.addColorStop(0, "#94a3b8"); grad.addColorStop(1, "#64748b");
    } else { // Iron
        grad.addColorStop(0, "#64748b"); grad.addColorStop(1, "#475569");
    }

    ctx.fillStyle = grad;
    ctx.fillText(text, x, y);
}

const RENDER_FONT_FAMILY = "SekaiFallbackSans";
let hasInitializedFonts = false;
let activeFontFamily = "sans-serif";
let activeHeaderFontFamily = "sans-serif";

function ensureRenderableFont() {
    if (hasInitializedFonts) return;

    const candidates = [
        resolve(process.cwd(), "public/fonts/NotoSans-Light.ttf"),
        resolve(process.cwd(), "public/fonts/NotoSans-Regular.ttf"),
        resolve(process.cwd(), "public/fonts/NotoSans-Medium.ttf"),
        process.env.SEKAI_FONT_PATH,
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ].filter((p): p is string => Boolean(p));

    for (const fontPath of candidates) {
        if (!existsSync(fontPath)) continue;
        try {
            GlobalFonts.registerFromPath(fontPath, RENDER_FONT_FAMILY);
            activeFontFamily = RENDER_FONT_FAMILY;
            break;
        } catch {
        }
    }

    const headerCandidates = [
        resolve(process.cwd(), "public/fonts/NotoSans-SemiBold.ttf"),
        resolve(process.cwd(), "public/fonts/NotoSans-Medium.ttf"),
        resolve(process.cwd(), "public/fonts/NotoSans-Regular.ttf"),
    ];
    for (const fontPath of headerCandidates) {
        if (!existsSync(fontPath)) continue;
        try {
            GlobalFonts.registerFromPath(fontPath, `${RENDER_FONT_FAMILY}Header`);
            activeHeaderFontFamily = `${RENDER_FONT_FAMILY}Header`;
            break;
        } catch {
        }
    }

    hasInitializedFonts = true;
}

function f(size: number, weight: "normal" | "bold" = "normal") {
    return `${weight} ${size}px "${activeFontFamily}"`;
}

function hf(size: number, weight: "normal" | "bold" = "normal") {
    return `${weight} ${size}px "${activeHeaderFontFamily}"`;
}

export async function generateResultImage(averageMmr: number, players: PlayerRow[], seasonId: number): Promise<Buffer> {
    ensureRenderableFont();
    const width = 1200;
    const height = 675;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (players.length === 0) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = hf(36);
        ctx.textAlign = 'center';
        ctx.fillText('No match data', width / 2, height / 2);
        return canvas.toBuffer('image/png');
    }

    // 1. Project Sekai Background
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#001A1A'); 
    bgGradient.addColorStop(1, '#050505'); 
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    const drawTriangle = (x: number, y: number, size: number, color: string, rotation: number = 0) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -size / 1.5);
        ctx.lineTo(size / 1.2, size / 1.5);
        ctx.lineTo(-size / 1.2, size / 1.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    };

    drawTriangle(width * 0.1, height * 0.2, 280, 'rgba(51, 204, 204, 0.08)', 0.5);
    drawTriangle(width * 0.9, height * 0.8, 350, 'rgba(255, 51, 153, 0.05)', -0.3);
    drawTriangle(width * 0.5, height * 0.1, 150, 'rgba(255, 255, 255, 0.03)', 1.2);

    ctx.strokeStyle = 'rgba(51, 204, 204, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 45); ctx.lineTo(width, 45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, height - 45); ctx.lineTo(width, height - 45); ctx.stroke();

    ctx.fillStyle = 'rgba(10, 10, 10, 0.7)';
    ctx.beginPath();
    ctx.roundRect(40, 40, width - 80, height - 80, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(51, 204, 204, 0.4)'; 
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#33CCCC';
    ctx.fillRect(40, 40, 40, 4); 
    ctx.fillRect(40, 40, 4, 40);
    ctx.fillRect(width - 80, height - 40, 40, 4);
    ctx.fillRect(width - 40, height - 80, 4, 40);

    // 2. Header Section
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = hf(16, 'bold');
    ctx.fillText(`SEKAI TOURNAMENT SYSTEM // S${seasonId}`, 90, 85);
    
    ctx.fillStyle = '#33CCCC'; 
    ctx.font = hf(34, 'bold');
    ctx.fillText(`MATCH RESULTS`, 90, 125);

    const avgMmrText = `ROOM AVG: ${averageMmr}`;
    ctx.font = f(20, 'bold');
    const textW = ctx.measureText(avgMmrText).width;
    
    ctx.fillStyle = '#33CCCC';
    ctx.fillRect(width - 90 - textW - 30, 85, textW + 30, 35);
    
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.fillText(avgMmrText, width - 90 - (textW + 30)/2, 110);

    // 3. Table Headers
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = hf(14, 'bold');
    ctx.fillText('RANK', 90, 205);
    ctx.fillText('PLAYER NAME', 180, 205);
    
    const metricsX = 550;
    ctx.fillStyle = '#27fafaff'; ctx.fillText('P', metricsX, 205);
    ctx.fillStyle = '#FF3399'; ctx.fillText('G', metricsX + 22, 205);
    ctx.fillStyle = '#00a3e4ff'; ctx.fillText('G', metricsX + 44, 205); 
    ctx.fillStyle = '#25f125ff'; ctx.fillText('B', metricsX + 66, 205); 
    ctx.fillStyle = '#666666'; ctx.fillText('M', metricsX + 88, 205);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('FINAL SCORE', 750, 205);
    ctx.fillText('RANKING PERFORMANCE', 930, 205);

    ctx.strokeStyle = 'rgba(51, 204, 204, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(90, 225); ctx.lineTo(width - 90, 225); ctx.stroke();

    // 4. Render Player Rows
    let y = 295;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];

        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.beginPath(); ctx.roundRect(70, y - 45, width - 140, 65, 5); ctx.fill();

        let rankColor = '#666666';
        if (i === 0) rankColor = '#33CCCC';
        if (i === 1) rankColor = '#FF3399';
        if (i === 2) rankColor = '#FFFFFF';
        
        ctx.fillStyle = rankColor;
        ctx.fillRect(70, y - 45, 6, 65);
        
        ctx.font = hf(24, 'bold');
        ctx.textAlign = 'center';
        ctx.fillText((i + 1).toString(), 105, y - 5);
        ctx.textAlign = 'left';

        try {
            const reg = p.region.replace(/[\[\]]/g, '').toLowerCase();
            const flagUrl = `https://flagcdn.com/w40/${reg === 'en' || reg === 'us' ? 'us' : reg}.png`;
            const flagImg = await loadImage(flagUrl);
            const flagH = 22;
            const flagW = (flagImg.width / flagImg.height) * flagH;
            ctx.drawImage(flagImg, 160, y - 28, flagW, flagH);
        } catch(e) {
            ctx.fillStyle = '#333333';
            ctx.fillRect(160, y - 28, 30, 20);
        }

        // Apply Gradient Rank Name
        ctx.font = f(20, 'bold');
        let displayName = p.username;
        if (displayName.length > 14) displayName = displayName.substring(0, 12) + '...';
        applyRankStyle(ctx, p, 230, y - 5, displayName);

        ctx.fillStyle = '#94A3B8';
        ctx.font = f(17);
        ctx.fillText(`| ${p.perfects} / ${p.greats} / ${p.goods} / ${p.bads} / ${p.misses}`, metricsX, y - 5);

        ctx.fillStyle = '#33CCCC';
        ctx.font = hf(22, 'bold');
        ctx.fillText(p.score.toLocaleString(), 750, y - 5);

        const sign = p.mmrChange >= 0 ? '+' : '';
        const signColor = p.mmrChange >= 0 ? '#33CCCC' : '#FF3399';

        ctx.font = f(16, 'bold');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(`${p.oldMmr} → `, 930, y - 5);
        const arrowW = ctx.measureText(`${p.oldMmr} → `).width;

        ctx.fillStyle = signColor;
        ctx.fillText(`${p.newMmr}`, 930 + arrowW, y - 5);
        const newW = ctx.measureText(`${p.newMmr}`).width;

        ctx.font = f(13, 'bold');
        ctx.fillText(` (${sign}${p.mmrChange})`, 930 + arrowW + newW, y - 5);

        y += 78;
    }

    return canvas.toBuffer('image/png');
}
