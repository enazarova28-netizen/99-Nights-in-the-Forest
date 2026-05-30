class CraftingSystem {
  constructor(player) {
    this.player      = player;
    this.selectedRec = 0;
    this.feedback    = '';
    this.feedbackTimer = 0;
  }

  canAfford(recipe) {
    for (const [res, amt] of Object.entries(recipe.cost)) {
      const have = this.player.res[res] ?? this.player.items[res] ?? 0;
      if (have < amt) return false;
    }
    return true;
  }

  craft(recipeId) {
    const rec = RECIPES.find(r => r.id === recipeId);
    if (!rec) return false;
    if (!this.canAfford(rec)) {
      this.feedback = 'Not enough materials!';
      this.feedbackTimer = 2000;
      return false;
    }

    // Deduct cost
    for (const [res, amt] of Object.entries(rec.cost)) {
      if (this.player.res[res] !== undefined) {
        this.player.res[res] -= amt;
      } else {
        this.player.removeItem(res, amt);
      }
    }

    // Give item
    if (rec.type === 'ammo') {
      this.player.arrows += rec.gives;
      this.feedback = `+${rec.gives} arrows`;
    } else {
      this.player.addItem(rec.id, 1);
      this.feedback = `Crafted: ${rec.name}`;
    }
    this.feedbackTimer = 2000;
    return true;
  }

  // Try to place the selected hotbar item as a tile
  placeItem(player, map) {
    const id = player.selectedItem();
    if (!id) return false;
    const rec = RECIPES.find(r => r.id === id && r.type === 'placeable');
    if (!rec) return false;
    if ((player.items[id] || 0) <= 0) return false;

    // Place 1 tile in facing direction
    const cx = player.x + player.w / 2 + player.facing.x * TILE_SIZE;
    const cy = player.y + player.h / 2 + player.facing.y * TILE_SIZE;
    const tx = Math.floor(cx / TILE_SIZE);
    const ty = Math.floor(cy / TILE_SIZE);

    if (map.get(tx, ty) !== T.GRASS) return false;

    // Don't wall yourself in — block placement on tiles the player occupies
    const ptx0 = Math.floor(player.x / TILE_SIZE);
    const pty0 = Math.floor(player.y / TILE_SIZE);
    const ptx1 = Math.floor((player.x + player.w - 1) / TILE_SIZE);
    const pty1 = Math.floor((player.y + player.h - 1) / TILE_SIZE);
    if (tx >= ptx0 && tx <= ptx1 && ty >= pty0 && ty <= pty1) return false;

    map.set(tx, ty, rec.tile);
    player.removeItem(id, 1);
    this.feedback = `Placed ${rec.name}`;
    this.feedbackTimer = 1500;
    return true;
  }

  update(dt) {
    if (this.feedbackTimer > 0) this.feedbackTimer -= dt;
  }
}
