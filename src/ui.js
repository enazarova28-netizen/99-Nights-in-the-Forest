class UI {
  constructor(game) {
    this.game = game;
    this.craftMenuOpen = false;
    this.selectedRecIdx = 0;
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  drawHUD(ctx, game) {
    const p = game.player;

    // Dark overlay strip top
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, 44);

    // HP bar
    ctx.fillStyle = '#500';
    ctx.fillRect(10, 10, 140, 14);
    ctx.fillStyle = p.hp > 40 ? '#e03030' : '#ff6666';
    ctx.fillRect(10, 10, 140 * (p.hp / p.maxHp), 14);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, 140, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`HP  ${p.hp}/${p.maxHp}`, 14, 22);

    // Night + phase
    const phaseLabel = game.phase === 'day' ? '☀ DAY' : '☾ NIGHT';
    const timeLeft   = Math.ceil(game.phaseTimer / 1000);
    ctx.fillStyle = game.phase === 'day' ? '#ffd700' : '#88aaff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Night ${game.nightNumber} / ${TOTAL_NIGHTS}   ${phaseLabel}  ${timeLeft}s`, CANVAS_W / 2, 24);

    // Kids saved
    ctx.fillStyle = '#aaffaa';
    ctx.font = '13px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Kids: ${game.kidsRescued}/4`, CANVAS_W - 10, 24);

    // Wave indicator
    if (game.waveActive) {
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`⚡ Wave ${game.currentWave}/10`, CANVAS_W - 10, 40);
    }

    // Resources panel (bottom-left)
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, CANVAS_H - 100, 130, 100);
    ctx.fillStyle = '#ccc';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('RESOURCES', 8, CANVAS_H - 82);
    ctx.fillStyle = '#c8a060'; ctx.fillText(`Wood:  ${p.res.wood}`,  8, CANVAS_H - 65);
    ctx.fillStyle = '#aaaaaa'; ctx.fillText(`Stone: ${p.res.stone}`, 8, CANVAS_H - 48);
    ctx.fillStyle = '#70dd60'; ctx.fillText(`Herb:  ${p.res.herb}`,  8, CANVAS_H - 31);
    ctx.fillStyle = '#ffdd44'; ctx.fillText(`Arrow: ${p.arrows}`,    8, CANVAS_H - 14);

    // Hotbar (bottom-center)
    this.drawHotbar(ctx, p);

    // Weapon
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`[${p.weapon.toUpperCase()}]`, CANVAS_W / 2, CANVAS_H - 56);

    // Context prompts at screen bottom
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    if (game.nearCraftingTable) {
      ctx.fillStyle = '#ffffaa';
      ctx.fillText('[E] Open Crafting Table', CANVAS_W / 2, CANVAS_H - 10);
    } else {
      ctx.fillStyle = '#88cc88';
      ctx.fillText('[E] Gather / Rescue kid / Place item    [Space] Attack', CANVAS_W / 2, CANVAS_H - 10);
    }

    // Crafting feedback
    if (game.crafting.feedbackTimer > 0) {
      ctx.fillStyle = '#aaffaa';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, game.crafting.feedbackTimer / 400);
      ctx.fillText(game.crafting.feedback, CANVAS_W / 2, CANVAS_H / 2 - 60);
      ctx.globalAlpha = 1;
    }

    // Announcement banner
    if (game.announcementTimer > 0) {
      const alpha = Math.min(1, game.announcementTimer / 500);
      ctx.fillStyle = `rgba(0,0,0,${alpha * 0.7})`;
      ctx.fillRect(0, CANVAS_H / 2 - 40, CANVAS_W, 80);
      ctx.fillStyle = `rgba(255,80,0,${alpha})`;
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(game.announcementText, CANVAS_W / 2, CANVAS_H / 2 + 10);
      game.announcementTimer -= 16;
    }
  }

  drawHotbar(ctx, p) {
    const slotW = 48;
    const slotH = 48;
    const total = 6;
    const startX = CANVAS_W / 2 - (total * slotW) / 2;
    const startY = CANVAS_H - slotH - 4;

    for (let i = 0; i < total; i++) {
      const x = startX + i * slotW;
      const y = startY;
      ctx.fillStyle = i === p.slot ? 'rgba(255,255,100,0.3)' : 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y, slotW - 2, slotH - 2);
      ctx.strokeStyle = i === p.slot ? '#ffd700' : '#555';
      ctx.lineWidth = i === p.slot ? 2 : 1;
      ctx.strokeRect(x, y, slotW - 2, slotH - 2);

      // Key number
      ctx.fillStyle = '#888';
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(String(i + 1), x + 2, y + 10);

      const id = p.hotbar[i];
      if (id) {
        const cnt = p.items[id] || 0;
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(id.replace('_', '\n'), x + slotW / 2 - 1, y + 28);
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(`×${cnt}`, x + slotW / 2 - 1, y + 40);
      }
    }
  }

  // ── Crafting menu ─────────────────────────────────────────────────────────
  drawCraftingMenu(ctx, crafting, player) {
    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = '#8b4513';
    ctx.fillRect(100, 50, CANVAS_W - 200, CANVAS_H - 100);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.strokeRect(100, 50, CANVAS_W - 200, CANVAS_H - 100);

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚒  CRAFTING TABLE  ⚒', CANVAS_W / 2, 82);

    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    ctx.fillText('[ESC] close   click recipe to craft', CANVAS_W / 2, 98);

    // Recipe list
    const listX  = 120;
    const listY  = 110;
    const rowH   = 42;

    RECIPES.forEach((rec, i) => {
      const y      = listY + i * rowH;
      const afford = crafting.canAfford(rec);
      const sel    = i === this.selectedRecIdx;

      ctx.fillStyle = sel ? 'rgba(255,215,0,0.2)' : (afford ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)');
      ctx.fillRect(listX, y, CANVAS_W - 240, rowH - 3);
      ctx.strokeStyle = sel ? '#ffd700' : '#555';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(listX, y, CANVAS_W - 240, rowH - 3);

      ctx.fillStyle = afford ? '#fff' : '#888';
      ctx.font = `${sel ? 'bold ' : ''}13px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(rec.name, listX + 8, y + 16);

      // Cost
      const costStr = Object.entries(rec.cost).map(([k, v]) => `${v}×${k}`).join('  ');
      ctx.fillStyle = afford ? '#c8a060' : '#774433';
      ctx.font = '11px monospace';
      ctx.fillText(costStr, listX + 8, y + 30);

      // Craft button
      if (afford) {
        ctx.fillStyle = sel ? '#ffd700' : '#9b6a30';
        ctx.fillRect(CANVAS_W - 240, y + 4, 80, rowH - 10);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('CRAFT', CANVAS_W - 200, y + rowH / 2 + 4);
      }
    });

    // Inventory summary on right
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Inventory:', CANVAS_W - 140, 130);
    ctx.fillStyle = '#ccc';
    ctx.font = '11px monospace';
    ctx.fillText(`Wood:  ${player.res.wood}`,  CANVAS_W - 140, 150);
    ctx.fillText(`Stone: ${player.res.stone}`, CANVAS_W - 140, 165);
    ctx.fillText(`Herb:  ${player.res.herb}`,  CANVAS_W - 140, 180);
    ctx.fillText(`Arrows:${player.arrows}`,    CANVAS_W - 140, 195);

    if (crafting.feedbackTimer > 0) {
      ctx.fillStyle = '#aaffaa';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(crafting.feedback, CANVAS_W / 2, CANVAS_H - 70);
    }
  }

  handleCraftingClick(mx, my, crafting) {
    const listX = 120;
    const listY = 110;
    const rowH  = 42;
    RECIPES.forEach((rec, i) => {
      const y = listY + i * rowH;
      if (mx >= listX && mx <= CANVAS_W - 120 && my >= y && my <= y + rowH - 3) {
        this.selectedRecIdx = i;
        crafting.craft(rec.id);
      }
    });
  }

  // ── Menu / overlays ───────────────────────────────────────────────────────
  drawMenu(ctx) {
    ctx.fillStyle = '#0a1a0a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.1})`;
      ctx.fillRect((i * 137) % CANVAS_W, (i * 89) % (CANVAS_H / 2), 2, 2);
    }

    ctx.fillStyle = '#2d5a27';
    ctx.fillRect(0, CANVAS_H * 0.55, CANVAS_W, CANVAS_H);

    ctx.fillStyle = '#1a3a16';
    for (let i = 0; i < 12; i++) {
      const tx = (i * 73) % (CANVAS_W - 40);
      const th = 80 + (i * 37) % 60;
      ctx.beginPath();
      ctx.moveTo(tx + 20, CANVAS_H * 0.55 - th);
      ctx.lineTo(tx, CANVAS_H * 0.55);
      ctx.lineTo(tx + 40, CANVAS_H * 0.55);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff8800';
    ctx.shadowBlur = 12;
    ctx.fillText('99 NIGHTS IN THE FOREST', CANVAS_W / 2, 120);
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#aaffaa';
    ctx.font = '16px monospace';
    ctx.fillText('Survive 99 nights. Save the 4 kids.', CANVAS_W / 2, 165);

    ctx.fillStyle = '#fff';
    ctx.font = '13px monospace';
    const controls = [
      'WASD / Arrows — Move',
      'Space — Attack / Shoot',
      'E — Interact / Gather / Place',
      '1-6 — Select hotbar item',
      'ESC — Close crafting menu',
    ];
    controls.forEach((line, i) => ctx.fillText(line, CANVAS_W / 2, 220 + i * 22));

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 18px monospace';
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) ctx.fillText('Press ENTER to begin', CANVAS_W / 2, CANVAS_H - 60);
  }

  drawGameOver(ctx, nightNum) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#ff2222';
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 20;
    ctx.fillText('YOU DIED', CANVAS_W / 2, CANVAS_H / 2 - 40);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ccc';
    ctx.font = '18px monospace';
    ctx.fillText(`Survived ${nightNum} nights`, CANVAS_W / 2, CANVAS_H / 2 + 10);
    ctx.fillStyle = '#888';
    ctx.font = '14px monospace';
    ctx.fillText('Press ENTER to try again', CANVAS_W / 2, CANVAS_H / 2 + 50);
  }

  drawVictory(ctx) {
    ctx.fillStyle = 'rgba(0,40,0,0.9)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 38px monospace';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffa500';
    ctx.shadowBlur = 18;
    ctx.fillText('YOU SURVIVED!', CANVAS_W / 2, CANVAS_H / 2 - 60);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aaffaa';
    ctx.font = '20px monospace';
    ctx.fillText('99 Nights in the Forest completed!', CANVAS_W / 2, CANVAS_H / 2 - 15);
    ctx.fillText('All 4 kids saved. The forest is safe.', CANVAS_W / 2, CANVAS_H / 2 + 20);
    ctx.fillStyle = '#888';
    ctx.font = '14px monospace';
    ctx.fillText('Press ENTER to play again', CANVAS_W / 2, CANVAS_H / 2 + 70);
  }

  drawNightSurvived(ctx) {
    ctx.fillStyle = '#aaaaff';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('NIGHT SURVIVED! +10 HP', CANVAS_W / 2, CANVAS_H / 2);
  }
}
