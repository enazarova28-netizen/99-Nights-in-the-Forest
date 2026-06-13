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

    // Signed-in username (top-left, below HP bar)
    if (typeof Net !== 'undefined' && Net.username) {
      ctx.fillStyle = '#44aa44'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillText('● ' + Net.username, 10, 38);
    }

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
    ctx.fillStyle = '#88cc88';
    ctx.fillText('[E] Gather / Rescue kid / Place item    [Space] Attack', CANVAS_W / 2, CANVAS_H - 10);

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

  drawMobileControls(ctx) {
    // Mobile D-pad (bottom-left, higher up)
    const padSize = 20;
    const padX = 16, padY = CANVAS_H - 170;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(padX, padY, padSize*3, padSize*3);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padX, padY, padSize*3, padSize*3);

    // Up/Down/Left/Right buttons
    const dirs = [
      { label: '↑', x: padX+padSize, y: padY, dx: 0, dy: -1 },
      { label: '↓', x: padX+padSize, y: padY+padSize*2, dx: 0, dy: 1 },
      { label: '←', x: padX, y: padY+padSize, dx: -1, dy: 0 },
      { label: '→', x: padX+padSize*2, y: padY+padSize, dx: 1, dy: 0 },
    ];
    dirs.forEach(d => {
      ctx.fillStyle = 'rgba(100,150,255,0.3)';
      ctx.fillRect(d.x, d.y, padSize, padSize);
      ctx.fillStyle = '#88ccff';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.label, d.x + padSize/2, d.y + padSize/2 + 5);
    });

    // Action buttons (bottom-right, higher up)
    const btnW = 44, btnH = 32, gap = 8;
    const attackX = CANVAS_W - btnW - 8;
    const attackY = CANVAS_H - btnH*3 - gap*2 - 8;
    const interactX = CANVAS_W - btnW*2 - gap - 8;
    const interactY = CANVAS_H - btnH*2 - gap - 8;
    const craftX = CANVAS_W - btnW - 8;
    const craftY = CANVAS_H - btnH - 8;

    // Attack button
    ctx.fillStyle = 'rgba(255,100,100,0.3)';
    ctx.fillRect(attackX, attackY, btnW, btnH);
    ctx.strokeStyle = '#ff6666';
    ctx.lineWidth = 1;
    ctx.strokeRect(attackX, attackY, btnW, btnH);
    ctx.fillStyle = '#ff8888';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚔', attackX + btnW/2, attackY + btnH/2 + 4);

    // Interact button
    ctx.fillStyle = 'rgba(100,200,100,0.3)';
    ctx.fillRect(interactX, interactY, btnW, btnH);
    ctx.strokeStyle = '#66cc66';
    ctx.lineWidth = 1;
    ctx.strokeRect(interactX, interactY, btnW, btnH);
    ctx.fillStyle = '#88dd88';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('E', interactX + btnW/2, interactY + btnH/2 + 4);

    // Crafting button
    ctx.fillStyle = 'rgba(200,150,100,0.3)';
    ctx.fillRect(craftX, craftY, btnW, btnH);
    ctx.strokeStyle = '#cc9966';
    ctx.lineWidth = 1;
    ctx.strokeRect(craftX, craftY, btnW, btnH);
    ctx.fillStyle = '#ddaa88';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚒', craftX + btnW/2, craftY + btnH/2 + 4);
  }

  // ── Crafting menu ─────────────────────────────────────────────────────────
  _craftCanAfford(rec, player) {
    return Object.entries(rec.cost).every(([res, cnt]) => (player.res[res] || 0) >= cnt);
  }

  drawCraftingMenu(ctx, crafting, player) {
    // Dim background
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Panel
    const PX = 90, PY = 45, PW = CANVAS_W - 180, PH = CANVAS_H - 90;
    ctx.fillStyle = '#6b3a10';
    ctx.fillRect(PX, PY, PW, PH);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
    ctx.strokeRect(PX, PY, PW, PH);

    // Title bar
    ctx.fillStyle = '#4a2808';
    ctx.fillRect(PX, PY, PW, 36);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillText('⚒  CRAFTING TABLE  ⚒', CANVAS_W / 2, PY + 23);

    // Close button
    const closeX = PX + PW - 72, closeY = PY + 6;
    ctx.fillStyle = '#8b0000';
    ctx.fillRect(closeX, closeY, 66, 24);
    ctx.strokeStyle = '#ff6666'; ctx.lineWidth = 1;
    ctx.strokeRect(closeX, closeY, 66, 24);
    ctx.fillStyle = '#ffaaaa'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('[X] Close', closeX + 33, closeY + 16);

    // ── Left panel: recipe list ───────────────────────────────────────────
    const listX = PX + 8, listW = 310, listY = PY + 44, rowH = 38;
    // Divider
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PX + listW + 16, PY + 44); ctx.lineTo(PX + listW + 16, PY + PH - 8); ctx.stroke();

    RECIPES.forEach((rec, i) => {
      const y      = listY + i * rowH;
      const afford = this._craftCanAfford(rec, player);
      const sel    = i === this.selectedRecIdx;

      ctx.fillStyle = sel ? 'rgba(255,215,0,0.25)' : (afford ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.25)');
      ctx.fillRect(listX, y, listW, rowH - 2);
      ctx.strokeStyle = sel ? '#ffd700' : '#555'; ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(listX, y, listW, rowH - 2);

      ctx.fillStyle = afford ? (sel ? '#ffd700' : '#fff') : '#777';
      ctx.font = `${sel ? 'bold ' : ''}12px monospace`; ctx.textAlign = 'left';
      ctx.fillText(rec.name, listX + 8, y + 14);

      const costStr = Object.entries(rec.cost).map(([k, v]) => `${v}×${k}`).join('  ');
      ctx.fillStyle = afford ? '#c8a060' : '#664422';
      ctx.font = '10px monospace';
      ctx.fillText(costStr, listX + 8, y + 28);
    });

    // ── Right panel: selected recipe details + CRAFT button ───────────────
    const rpX = PX + listW + 24, rpY = PY + 44, rpW = PW - listW - 32;
    const rec = RECIPES[this.selectedRecIdx];

    if (!rec) {
      ctx.fillStyle = '#888'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('← select a recipe', rpX + rpW / 2, rpY + 60);
    } else {
      const afford = this._craftCanAfford(rec, player);

      // Recipe name
      ctx.fillStyle = '#ffd700'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
      ctx.fillText(rec.name, rpX, rpY + 20);

      // Cost breakdown
      ctx.fillStyle = '#aaa'; ctx.font = '11px monospace';
      ctx.fillText('Needs:', rpX, rpY + 42);
      let cy = rpY + 58;
      for (const [res, cnt] of Object.entries(rec.cost)) {
        const have  = player.res[res] || 0;
        const ok    = have >= cnt;
        ctx.fillStyle = ok ? '#88ff88' : '#ff8888';
        ctx.fillText(`${res}: ${have}/${cnt}`, rpX + 8, cy);
        cy += 16;
      }

      // Inventory
      cy += 8;
      ctx.fillStyle = '#aaa'; ctx.font = '11px monospace';
      ctx.fillText('Your resources:', rpX, cy); cy += 16;
      ctx.fillStyle = '#c8a060'; ctx.fillText(`Wood:  ${player.res.wood  || 0}`, rpX + 8, cy); cy += 14;
      ctx.fillStyle = '#aaaaaa'; ctx.fillText(`Stone: ${player.res.stone || 0}`, rpX + 8, cy); cy += 14;
      ctx.fillStyle = '#70dd60'; ctx.fillText(`Herb:  ${player.res.herb  || 0}`, rpX + 8, cy); cy += 14;
      ctx.fillStyle = '#ffdd44'; ctx.fillText(`Arrow: ${player.arrows   || 0}`, rpX + 8, cy);

      // CRAFT button
      const btnY  = rpY + rpW - 10;  // near bottom of right panel
      const btnH  = 34;
      const btnW2 = rpW - 4;
      ctx.fillStyle = afford ? '#2a7a2a' : '#444';
      ctx.fillRect(rpX, PY + PH - 50, btnW2, btnH);
      ctx.strokeStyle = afford ? '#88ff88' : '#666'; ctx.lineWidth = 2;
      ctx.strokeRect(rpX, PY + PH - 50, btnW2, btnH);
      ctx.fillStyle = afford ? '#aaffaa' : '#777';
      ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
      ctx.fillText(afford ? 'CRAFT' : 'Not enough', rpX + btnW2 / 2, PY + PH - 50 + 22);
    }

    if (crafting.feedbackTimer > 0) {
      ctx.fillStyle = '#aaffaa'; ctx.font = '13px monospace'; ctx.textAlign = 'center';
      ctx.fillText(crafting.feedback, CANVAS_W / 2, PY + PH - 8);
    }
  }

  handleCraftingClick(mx, my, crafting, game) {
    const isOnline = game.menuMode === 'ONLINE';
    const player   = isOnline
      ? (() => { const s = game._onlineState; const me = s && s.players.find(p => p.username === Net.username); return me || { res:{}, arrows:0 }; })()
      : game.player;

    const PX = 90, PY = 45, PW = CANVAS_W - 180, PH = CANVAS_H - 90;

    // Close button
    const closeX = PX + PW - 72, closeY = PY + 6;
    if (mx >= closeX && mx <= closeX + 66 && my >= closeY && my <= closeY + 24) {
      game.state = isOnline ? 'ONLINE' : 'PLAYING';
      return;
    }

    // Recipe list (left panel)
    const listX = PX + 8, listW = 310, listY = PY + 44, rowH = 38;
    RECIPES.forEach((rec, i) => {
      const y = listY + i * rowH;
      if (mx >= listX && mx <= listX + listW && my >= y && my <= y + rowH - 2) {
        this.selectedRecIdx = i;
      }
    });

    // CRAFT button (right panel, bottom)
    const rec = RECIPES[this.selectedRecIdx];
    if (rec) {
      const rpX   = PX + listW + 24;
      const rpW   = PW - listW - 32;
      const btnY  = PY + PH - 50;
      const btnH  = 34;
      if (mx >= rpX && mx <= rpX + rpW - 4 && my >= btnY && my <= btnY + btnH) {
        if (isOnline) {
          game._pendingOnlineAction = `craft:${rec.id}`;
        } else {
          crafting.craft(rec.id);
        }
      }
    }
  }

  // ── Menu / overlays ───────────────────────────────────────────────────────
  drawMenu(ctx, menuMode = 'SOLO', onlineEnabled = true) {
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
      'WASD — Move    Space — Attack    E — Interact / Gather',
      '1-6 — Hotbar    ESC — Open crafting table',
    ];
    controls.forEach((line, i) => ctx.fillText(line, CANVAS_W / 2, 212 + i * 22));

    // Mode selection — two large boxes
    const modes = [
      { id: 'SOLO',   label: 'SINGLE PLAYER', sub: 'Play alone', key: '[1]' },
      { id: 'ONLINE', label: 'MULTIPLAYER',    sub: 'Up to 4 players online', key: '[2]' },
    ];
    const bw = 220, bh = 80, gap = 24;
    const totalW = modes.length * bw + gap;
    const startX = (CANVAS_W - totalW) / 2;
    const by2 = 260;

    modes.forEach((m, i) => {
      const bx = startX + i * (bw + gap);
      const sel = menuMode === m.id;
      ctx.fillStyle = sel ? 'rgba(255,215,0,0.18)' : 'rgba(0,0,0,0.45)';
      ctx.fillRect(bx, by2, bw, bh);
      ctx.strokeStyle = sel ? '#ffd700' : '#555';
      ctx.lineWidth = sel ? 2.5 : 1;
      ctx.strokeRect(bx, by2, bw, bh);
      ctx.fillStyle = sel ? '#ffd700' : '#aaa';
      ctx.font = `bold 16px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(m.label, bx + bw / 2, by2 + 32);
      ctx.fillStyle = sel ? '#ddd' : '#666';
      ctx.font = '11px monospace';
      ctx.fillText(m.sub, bx + bw / 2, by2 + 52);
      ctx.fillStyle = '#555'; ctx.font = '10px monospace';
      ctx.fillText(m.key, bx + bw / 2, by2 + 68);
    });

    ctx.fillStyle = '#aaa';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('← → or 1/2 to choose', CANVAS_W / 2, 358);

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 18px monospace';
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) ctx.fillText('Press ENTER to begin', CANVAS_W / 2, CANVAS_H - 50);

    if (!onlineEnabled) {
      ctx.fillStyle = '#ffdd88';
      ctx.font = '12px monospace';
      ctx.fillText('GitHub Pages supports local single-player only.', CANVAS_W / 2, CANVAS_H - 28);
    }

    // ── Account panel (top-right) ──────────────────────────────────────────
    if (typeof Net !== 'undefined' && Net.username) {
      const apx = CANVAS_W - 178, apy = 8, apw = 170, aph = 68;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(apx, apy, apw, aph);
      ctx.strokeStyle = '#44aa44'; ctx.lineWidth = 1.5;
      ctx.strokeRect(apx, apy, apw, aph);

      // Avatar circle with first letter
      ctx.fillStyle = '#44aa44';
      ctx.beginPath(); ctx.arc(apx + 24, apy + 24, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
      ctx.fillText(Net.username[0].toUpperCase(), apx + 24, apy + 29);

      // Name + status
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left';
      ctx.fillText(Net.username, apx + 48, apy + 22);
      ctx.fillStyle = '#44cc44'; ctx.font = '10px monospace';
      ctx.fillText('● Signed in', apx + 48, apy + 37);

      // Log out hint
      ctx.fillStyle = '#cc4444'; ctx.font = 'bold 10px monospace';
      ctx.fillText('[Q] Log out', apx + 48, apy + 55);
    } else {
      // Not signed in — prompt
      const apx = CANVAS_W - 178, apy = 8, apw = 170, aph = 40;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(apx, apy, apw, aph);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(apx, apy, apw, aph);
      ctx.fillStyle = '#888'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText('Not signed in', apx + apw/2, apy + 16);
      ctx.fillStyle = '#ffd700'; ctx.font = 'bold 10px monospace';
      ctx.fillText('[Q] Sign in / Register', apx + apw/2, apy + 32);
    }
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

  // ── Login / Register screen ───────────────────────────────────────────────
  drawLoginScreen(ctx, fields, mode, error) {
    // mode: 'login' | 'register'
    ctx.fillStyle = '#0a1a0a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + (i%5)*0.1})`;
      ctx.fillRect((i*137)%CANVAS_W, (i*89)%(CANVAS_H/2), 2, 2);
    }

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
    ctx.shadowColor = '#ff8800'; ctx.shadowBlur = 10;
    ctx.fillText('99 NIGHTS IN THE FOREST', CANVAS_W/2, 72);
    ctx.shadowBlur = 0;

    // Panel
    const px = CANVAS_W/2 - 190, py = 96, pw = 380, ph = mode === 'register' ? 300 : 260;

    // ── Mode tabs ──
    const tabW = pw / 2;
    const tabs = [{ id:'login', label:'SIGN IN' }, { id:'register', label:'SIGN UP' }];
    tabs.forEach((tab, i) => {
      const tx = px + i * tabW;
      const active = mode === tab.id;
      ctx.fillStyle = active ? 'rgba(255,215,0,0.18)' : 'rgba(0,0,0,0.5)';
      ctx.fillRect(tx, py, tabW, 40);
      ctx.strokeStyle = active ? '#ffd700' : '#444';
      ctx.lineWidth = active ? 2 : 1;
      ctx.strokeRect(tx, py, tabW, 40);
      ctx.fillStyle = active ? '#ffd700' : '#666';
      ctx.font = `bold 14px monospace`; ctx.textAlign = 'center';
      ctx.fillText(tab.label, tx + tabW/2, py + 25);
    });

    // Panel body (below tabs)
    const bodyY = py + 40;
    const bodyH = ph - 40;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(px, bodyY, pw, bodyH);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.5; ctx.strokeRect(px, bodyY, pw, bodyH);

    // Username field
    this._drawField(ctx, 'Username', fields.username, px+20, bodyY+18, pw-40,
                    fields.focus === 'username');
    // Password field
    this._drawField(ctx, 'Password', '•'.repeat(fields.password.length), px+20, bodyY+86, pw-40,
                    fields.focus === 'password');
    // Confirm password (register only)
    if (mode === 'register') {
      this._drawField(ctx, 'Confirm Password', '•'.repeat(fields.confirm.length), px+20, bodyY+154, pw-40,
                      fields.focus === 'confirm');
    }

    // Error
    if (error) {
      ctx.fillStyle = '#ff6666'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(error, CANVAS_W/2, bodyY + bodyH - (mode==='register'?36:52));
    }

    // Submit button
    const btnY = bodyY + bodyH - 30;
    ctx.fillStyle = 'rgba(255,215,0,0.15)'; ctx.fillRect(px+60, btnY, pw-120, 24);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1; ctx.strokeRect(px+60, btnY, pw-120, 24);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
    ctx.fillText('[ Enter ] ' + (mode === 'login' ? 'Sign In' : 'Create Account'), CANVAS_W/2, btnY+16);

    // Footer hints
    ctx.fillStyle = '#555'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('Tab — next field   ← → — switch Sign In / Sign Up', CANVAS_W/2, CANVAS_H - 16);
  }

  _drawField(ctx, label, value, x, y, w, focused) {
    ctx.fillStyle = '#666'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText(label, x, y);
    const fh = 28;
    ctx.fillStyle = focused ? 'rgba(255,215,0,0.1)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(x, y+4, w, fh);
    ctx.strokeStyle = focused ? '#ffd700' : '#444'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y+4, w, fh);
    ctx.fillStyle = focused ? '#fff' : '#ccc'; ctx.font = '13px monospace';
    ctx.fillText(value + (focused && Math.floor(Date.now()/500)%2===0 ? '|' : ''), x+8, y+22);
  }

  // ── Lobby list screen ────────────────────────────────────────────────────
  drawLobbyListScreen(ctx, lobbies, error) {
    ctx.fillStyle = '#0a1a0a'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i=0;i<60;i++) {
      ctx.fillStyle=`rgba(255,255,255,${0.3+(i%5)*0.1})`;
      ctx.fillRect((i*137)%CANVAS_W,(i*89)%(CANVAS_H/2),2,2);
    }

    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
    ctx.fillText('ONLINE LOBBIES', CANVAS_W/2, 54);
    ctx.fillStyle = '#aaa'; ctx.font = '11px monospace';
    ctx.fillText('Logged in as: ' + Net.username, CANVAS_W/2, 72);

    // Create button
    const cbx = CANVAS_W/2 - 80, cby = 84;
    ctx.fillStyle = 'rgba(255,215,0,0.15)'; ctx.fillRect(cbx, cby, 160, 28);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1; ctx.strokeRect(cbx, cby, 160, 28);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    ctx.fillText('[C] Create New Lobby', CANVAS_W/2, cby+18);

    // Lobby list
    const startY = 128;
    if (!lobbies || lobbies.length === 0) {
      ctx.fillStyle = '#555'; ctx.font = '13px monospace'; ctx.textAlign = 'center';
      ctx.fillText('No lobbies yet — create one!', CANVAS_W/2, startY + 30);
    } else {
      lobbies.forEach((l, i) => {
        const ry = startY + i * 52;
        const full = l.playerCount >= 4;
        ctx.fillStyle = full ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(CANVAS_W/2-240, ry, 480, 44);
        ctx.strokeStyle = full ? '#444' : '#666'; ctx.lineWidth = 1;
        ctx.strokeRect(CANVAS_W/2-240, ry, 480, 44);

        ctx.fillStyle = full ? '#555' : '#fff'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
        ctx.fillText(l.name, CANVAS_W/2-228, ry+18);
        ctx.fillStyle = '#888'; ctx.font = '11px monospace';
        ctx.fillText(`Host: ${l.host}`, CANVAS_W/2-228, ry+35);

        ctx.fillStyle = full ? '#ff4444' : '#aaffaa'; ctx.textAlign = 'right';
        ctx.fillText(`${l.playerCount}/4`, CANVAS_W/2+228, ry+18);
        if (!full) {
          ctx.fillStyle = '#ffd700'; ctx.font = 'bold 11px monospace';
          ctx.fillText(`[${i+1}] Join`, CANVAS_W/2+228, ry+35);
        }
      });
    }

    // Error / refresh
    if (error) {
      ctx.fillStyle = '#ff6666'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(error, CANVAS_W/2, CANVAS_H - 44);
    }
    ctx.fillStyle = '#555'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('[R] Refresh   [Esc] Back to local menu   [Q] Logout', CANVAS_W/2, CANVAS_H - 16);

  }

  // ── Lobby wait / pre-game room ────────────────────────────────────────────
  drawLobbyWaitScreen(ctx, lobbyPlayers, isHost) {
    ctx.fillStyle = '#0a1a0a'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i=0;i<60;i++) {
      ctx.fillStyle=`rgba(255,255,255,${0.3+(i%5)*0.1})`;
      ctx.fillRect((i*137)%CANVAS_W,(i*89)%(CANVAS_H/2),2,2);
    }

    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
    ctx.fillText('WAITING FOR PLAYERS', CANVAS_W/2, 60);
    ctx.fillStyle = '#aaa'; ctx.font = '12px monospace';
    ctx.fillText('Up to 4 players can join. Share this lobby!', CANVAS_W/2, 84);

    // Player slots
    const colors = ['#4488ff','#ff8844','#44cc44','#cc44cc'];
    for (let i = 0; i < 4; i++) {
      const pl = lobbyPlayers[i];
      const sx = CANVAS_W/2 - 300 + i * 160, sy = 120;
      ctx.fillStyle = pl ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.4)';
      ctx.fillRect(sx, sy, 140, 80);
      ctx.strokeStyle = pl ? colors[i] : '#333'; ctx.lineWidth = pl ? 2 : 1;
      ctx.strokeRect(sx, sy, 140, 80);

      if (pl) {
        // Player swatch
        ctx.fillStyle = colors[i]; ctx.fillRect(sx+10, sy+10, 24, 36);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left';
        ctx.fillText(pl.username, sx+42, sy+26);
        ctx.fillStyle = '#888'; ctx.font = '10px monospace';
        ctx.fillText(i === 0 ? 'Host' : `P${i+1}`, sx+42, sy+42);
      } else {
        ctx.fillStyle = '#444'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('Empty', sx+70, sy+46);
      }
    }

    // Controls reminder
    ctx.fillStyle = '#ccc'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
    ctx.fillText('Each player uses WASD to move, Space to attack, E to interact', CANVAS_W/2, 240);
    ctx.fillStyle = '#888'; ctx.font = '11px monospace';
    ctx.fillText('Resources are individual. Crafting & kid rescue shared.', CANVAS_W/2, 260);

    if (isHost) {
      const blink = Math.floor(Date.now()/500)%2===0;
      ctx.fillStyle = blink ? '#ffd700' : '#aa8800';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('[ Enter ] Start Game', CANVAS_W/2, 310);
      ctx.fillStyle = '#888'; ctx.font = '11px monospace';
      ctx.fillText('(You are the host — others are waiting)', CANVAS_W/2, 330);
    } else {
      ctx.fillStyle = '#aaffaa'; ctx.font = '15px monospace';
      ctx.fillText('Waiting for host to start…', CANVAS_W/2, 314);
    }

    ctx.fillStyle = '#555'; ctx.font = '10px monospace';
    ctx.fillText('[Esc] Leave lobby', CANVAS_W/2, CANVAS_H - 16);
  }

  // ── Online game HUD overlay (announcement from server) ────────────────────
  drawOnlineAnnouncement(ctx, text) {
    if (!text) return;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, CANVAS_H/2 - 40, CANVAS_W, 80);
    ctx.fillStyle = 'rgba(255,80,0,1)';
    ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
    ctx.fillText(text, CANVAS_W/2, CANVAS_H/2 + 10);
  }
}
