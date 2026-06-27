// ── 3D Renderer (Three.js) ────────────────────────────────────────────────────
// Renders the game world in 3D. The existing 2D canvas is kept as a
// transparent overlay for HUD/UI. Game logic stays 100% 2D server-side.

class Renderer3D {
  constructor() {
    // WebGL renderer — new canvas inserted BEFORE the 2D canvas
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(CANVAS_W, CANVAS_H);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas2d = document.getElementById('game');
    const wrap = canvas2d.parentNode;

    const container = document.createElement('div');
    container.style.cssText =
      `position:relative;display:block;width:${CANVAS_W}px;height:${CANVAS_H}px;` +
      `border:2px solid #1a3a1a;flex-shrink:0;`;
    wrap.insertBefore(container, canvas2d);
    container.appendChild(this.renderer.domElement);
    container.appendChild(canvas2d);

    this.renderer.domElement.style.cssText =
      'position:absolute;top:0;left:0;display:block;';
    canvas2d.style.cssText =
      'position:absolute;top:0;left:0;display:block;pointer-events:auto;border:none;';

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7ab8f5);
    this.scene.fog = new THREE.Fog(0x7ab8f5, 20, 60);

    // Camera — perspective, behind-and-above the player
    this.camera = new THREE.PerspectiveCamera(55, CANVAS_W / CANVAS_H, 0.1, 200);

    // Lights
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5cc, 0.9);
    this.sunLight.position.set(15, 30, 10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 120;
    this.sunLight.shadow.camera.left = -30;
    this.sunLight.shadow.camera.right = 30;
    this.sunLight.shadow.camera.top = 30;
    this.sunLight.shadow.camera.bottom = -30;
    this.scene.add(this.sunLight);

    // Ground plane (entire map)
    const groundGeo = new THREE.PlaneGeometry(MAP_COLS, MAP_ROWS);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(MAP_COLS / 2, 0, MAP_ROWS / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Checkerboard accent on ground (darker alternating tiles)
    this._groundAccent = this._buildGroundAccent();
    this.scene.add(this._groundAccent);

    // Tile meshes: index → THREE.Object3D
    this.tileMeshes = new Map();

    // Entity meshes
    this.playerMeshes = new Map(); // username → Group
    this.enemyMeshes  = new Map(); // id → Group
    this.kidMeshes    = new Map(); // idx → Group

    // Projectile meshes
    this.projMeshes   = new Map(); // id → Mesh

    // Reusable materials
    this._M = this._makeMaterials();

    this.initialized = false;
  }

  // ── Ground checkerboard ───────────────────────────────────────────────────
  _buildGroundAccent() {
    const geo = new THREE.BufferGeometry();
    const verts = [];
    const mat = new THREE.MeshLambertMaterial({ color: 0x285224, side: THREE.DoubleSide });
    const group = new THREE.Group();
    // Draw every other tile as slightly darker quad at y=0.005
    for (let ty = 0; ty < MAP_ROWS; ty++) {
      for (let tx = 0; tx < MAP_COLS; tx++) {
        if ((tx + ty) % 2 === 0) continue;
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          mat
        );
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(tx + 0.5, 0.005, ty + 0.5);
        group.add(plane);
      }
    }
    return group;
  }

  // ── Materials ─────────────────────────────────────────────────────────────
  _makeMaterials() {
    const c = (hex) => new THREE.MeshLambertMaterial({ color: hex });
    return {
      treeTrunk:   c(0x6b4226),
      treeLeaf:    c(0x1e5c14),
      treeLeaf2:   c(0x2a7a20),
      rock:        c(0x8a8a8a),
      rockDark:    c(0x666666),
      woodWall:    c(0x8b4513),
      woodWallDk:  c(0x5c2e00),
      stoneWall:   c(0x777777),
      stoneWallDk: c(0x555555),
      door:        c(0xa0522d),
      doorGold:    c(0xffd700),
      craftTable:  c(0x8b4513),
      craftTop:    c(0xa0522d),
      herb:        c(0x5db83a),
      herbStem:    c(0x3d8c1e),
      campfire:    c(0x8b4513),
      flame:       c(0xff4400),
      flameInner:  c(0xffa500),
      chestBody:   c(0x7a4a20),
      chestLid:    c(0xffd700),
      mine:        c(0x111111),
      minePlank:   c(0x6b4226),
      stump:       c(0x8b5e3c),
      stumpRing:   c(0xa07040),
      farmDirt:    c(0x4a3a1a),
      farmCrop:    c(0x5db83a),
      skin:        c(0xffcc99),
      hatRed:      c(0xcc2222),
    };
  }

  // ── Tile helpers ──────────────────────────────────────────────────────────
  _tileCenter(tx, ty) { return { x: tx + 0.5, z: ty + 0.5 }; }

  _addShadow(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  _box(w, h, d, mat, px, py, pz) {
    const m = this._addShadow(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
    m.position.set(px, py, pz);
    return m;
  }

  _createTileMesh(type, tx, ty) {
    const { x, z } = this._tileCenter(tx, ty);
    const M = this._M;
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    switch (type) {
      case T.TREE: {
        // Trunk
        const trunk = this._addShadow(new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.14, 0.65, 6), M.treeTrunk));
        trunk.position.set(0, 0.325, 0);
        g.add(trunk);
        // Lower canopy
        const can1 = this._addShadow(new THREE.Mesh(
          new THREE.ConeGeometry(0.48, 0.7, 7), M.treeLeaf));
        can1.position.set(0, 0.9, 0);
        g.add(can1);
        // Upper canopy
        const can2 = this._addShadow(new THREE.Mesh(
          new THREE.ConeGeometry(0.3, 0.55, 7), M.treeLeaf2));
        can2.position.set(0, 1.38, 0);
        g.add(can2);
        break;
      }
      case T.STUMP: {
        const s = this._addShadow(new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.24, 0.22, 7), M.stump));
        s.position.set(0, 0.11, 0);
        g.add(s);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.1, 0.2, 12), M.stumpRing);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(0, 0.23, 0);
        g.add(ring);
        break;
      }
      case T.ROCK: {
        const r = this._addShadow(new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.33, 0), M.rock));
        r.scale.set(1, 0.6, 0.85);
        r.position.set(0, 0.2, 0);
        r.rotation.y = Math.random() * Math.PI;
        g.add(r);
        break;
      }
      case T.WOOD_WALL: {
        const w = this._addShadow(new THREE.Mesh(
          new THREE.BoxGeometry(1, 1.3, 1), M.woodWall));
        w.position.set(0, 0.65, 0);
        g.add(w);
        // Horizontal plank lines
        for (let i = 0; i < 3; i++) {
          const line = new THREE.Mesh(
            new THREE.BoxGeometry(1.01, 0.04, 1.01), M.woodWallDk);
          line.position.set(0, 0.18 + i * 0.48, 0);
          g.add(line);
        }
        break;
      }
      case T.STONE_WALL: {
        const sw = this._addShadow(new THREE.Mesh(
          new THREE.BoxGeometry(1, 1.3, 1), M.stoneWall));
        sw.position.set(0, 0.65, 0);
        g.add(sw);
        // Stone block pattern
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 2; col++) {
            const blk = new THREE.Mesh(
              new THREE.BoxGeometry(0.45, 0.35, 1.02), M.stoneWallDk);
            blk.position.set(-0.24 + col * 0.48, 0.18 + row * 0.44, 0);
            g.add(blk);
          }
        }
        break;
      }
      case T.DOOR: {
        // Frame
        const frame = this._addShadow(new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 1.1, 0.12), M.woodWallDk));
        frame.position.set(0, 0.55, 0);
        g.add(frame);
        // Door panel
        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(0.72, 0.95, 0.1), M.door);
        panel.position.set(0, 0.55, 0.02);
        g.add(panel);
        // Knob
        const knob = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 6, 6), M.doorGold);
        knob.position.set(0.26, 0.5, 0.1);
        g.add(knob);
        break;
      }
      case T.CRAFTING_TABLE: {
        const top = this._addShadow(new THREE.Mesh(
          new THREE.BoxGeometry(0.92, 0.12, 0.92), M.craftTop));
        top.position.set(0, 0.56, 0);
        g.add(top);
        const base = this._addShadow(new THREE.Mesh(
          new THREE.BoxGeometry(0.85, 0.5, 0.85), M.craftTable));
        base.position.set(0, 0.25, 0);
        g.add(base);
        // Cross groove on top
        const cx = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.04, 0.06), M.woodWallDk);
        cx.position.set(0, 0.63, 0); g.add(cx);
        const cz = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.86), M.woodWallDk);
        cz.position.set(0, 0.63, 0); g.add(cz);
        break;
      }
      case T.HERB: {
        for (let i = 0; i < 3; i++) {
          const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.02, 0.2, 4), M.herbStem);
          stem.position.set(-0.15 + i * 0.15, 0.1, -0.05 + i * 0.05);
          stem.rotation.z = (-0.3 + i * 0.3);
          g.add(stem);
          const leaf = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 5, 5), M.herb);
          leaf.scale.set(1.4, 0.6, 1.0);
          leaf.position.set(-0.15 + i * 0.15, 0.22, -0.05 + i * 0.05);
          g.add(leaf);
        }
        break;
      }
      case T.CAMPFIRE: {
        // Log base
        const log = this._addShadow(new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.3, 0.12, 7), M.campfire));
        log.position.set(0, 0.06, 0);
        g.add(log);
        // Flames
        const fl1 = new THREE.Mesh(
          new THREE.ConeGeometry(0.14, 0.42, 6), M.flame);
        fl1.position.set(0, 0.33, 0);
        g.add(fl1);
        const fl2 = new THREE.Mesh(
          new THREE.ConeGeometry(0.08, 0.28, 5), M.flameInner);
        fl2.position.set(0, 0.28, 0);
        g.add(fl2);
        break;
      }
      case T.TRAP: {
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.06, 0.8), M.stoneWall);
        base.position.set(0, 0.03, 0);
        g.add(base);
        // X spikes
        for (const a of [0, Math.PI / 2]) {
          const spike = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.06, 0.06), M.rock);
          spike.rotation.y = a;
          spike.position.set(0, 0.09, 0);
          g.add(spike);
        }
        break;
      }
      case T.FARM: {
        const dirt = new THREE.Mesh(
          new THREE.BoxGeometry(0.95, 0.08, 0.95), M.farmDirt);
        dirt.position.set(0, 0.04, 0);
        g.add(dirt);
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const sprout = new THREE.Mesh(
              new THREE.ConeGeometry(0.04, 0.18, 4), M.farmCrop);
            sprout.position.set(-0.28 + c * 0.28, 0.17, -0.28 + r * 0.28);
            g.add(sprout);
          }
        }
        break;
      }
      case T.CHEST: {
        const body = this._addShadow(new THREE.Mesh(
          new THREE.BoxGeometry(0.65, 0.38, 0.45), M.chestBody));
        body.position.set(0, 0.19, 0);
        g.add(body);
        const lid = this._addShadow(new THREE.Mesh(
          new THREE.BoxGeometry(0.65, 0.14, 0.45), M.chestLid));
        lid.position.set(0, 0.45, 0);
        g.add(lid);
        // Latch
        const latch = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.06, 0.06), M.doorGold);
        latch.position.set(0, 0.39, 0.24);
        g.add(latch);
        break;
      }
      case T.MINE_ENTRANCE: {
        // Dark fill
        const fill = this._addShadow(new THREE.Mesh(
          new THREE.BoxGeometry(1, 0.95, 0.18), M.mine));
        fill.position.set(0, 0.475, 0);
        g.add(fill);
        // X-boards
        for (const a of [0.55, -0.55]) {
          const plank = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 0.08, 0.06), M.minePlank);
          plank.rotation.z = a;
          plank.position.set(0, 0.48, 0.1);
          g.add(plank);
        }
        break;
      }
      default:
        return null;
    }
    return g;
  }

  // ── Public: init world from flat Uint8Array ───────────────────────────────
  initTiles(tiles) {
    for (const m of this.tileMeshes.values()) this.scene.remove(m);
    this.tileMeshes.clear();

    for (let i = 0; i < tiles.length; i++) {
      const type = tiles[i];
      if (type === T.GRASS) continue;
      const tx = i % MAP_COLS;
      const ty = Math.floor(i / MAP_COLS);
      const mesh = this._createTileMesh(type, tx, ty);
      if (mesh) { this.scene.add(mesh); this.tileMeshes.set(i, mesh); }
    }
    this.initialized = true;
  }

  // ── Public: apply a single tile change ───────────────────────────────────
  updateTile(i, type) {
    if (this.tileMeshes.has(i)) {
      this.scene.remove(this.tileMeshes.get(i));
      this.tileMeshes.delete(i);
    }
    if (type !== T.GRASS) {
      const tx = i % MAP_COLS, ty = Math.floor(i / MAP_COLS);
      const mesh = this._createTileMesh(type, tx, ty);
      if (mesh) { this.scene.add(mesh); this.tileMeshes.set(i, mesh); }
    }
  }

  // ── Humanoid character builder ────────────────────────────────────────────
  _makeHumanoid(bodyHex, hatHex, scale = 1) {
    const g     = new THREE.Group();
    const bodyM = new THREE.MeshLambertMaterial({ color: new THREE.Color(bodyHex) });
    const hatM  = new THREE.MeshLambertMaterial({ color: new THREE.Color(hatHex)  });

    // Body
    const body = this._addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.52, 0.28), bodyM));
    body.position.set(0, 0.42, 0); g.add(body);

    // Head
    const head = this._addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), this._M.skin));
    head.position.set(0, 0.83, 0); g.add(head);

    // Hat brim
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.36), hatM);
    brim.position.set(0, 0.99, 0); g.add(brim);
    // Hat top
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.28), hatM);
    top.position.set(0, 1.12, 0); g.add(top);

    // Eyes (tiny dark boxes)
    const eyeM = new THREE.MeshLambertMaterial({ color: 0x111111 });
    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), eyeM);
      eye.position.set(ex, 0.84, 0.16); g.add(eye);
    }

    g.scale.setScalar(scale);
    return g;
  }

  // ── Public: update all entities ───────────────────────────────────────────
  updatePlayers(players) {
    const seen = new Set();
    for (const p of players) {
      seen.add(p.username);
      if (!this.playerMeshes.has(p.username)) {
        const g = this._makeHumanoid(p.bodyColor || '#4488ff', p.bodyColor || '#4488ff');
        this.scene.add(g);
        this.playerMeshes.set(p.username, g);
      }
      const g = this.playerMeshes.get(p.username);
      g.position.set(
        p.x / TILE_SIZE + p.w / (2 * TILE_SIZE),
        p.downed ? 0 : 0,
        p.y / TILE_SIZE + p.h / (2 * TILE_SIZE)
      );
      g.rotation.y = 0;
      g.visible = true;
    }
    for (const [name, g] of this.playerMeshes) {
      if (!seen.has(name)) { this.scene.remove(g); this.playerMeshes.delete(name); }
    }
  }

  _buildEnemyMesh(type) {
    let g;
    if (type === 'BipedalDeer') {
      g = this._makeHumanoid('#8b5e3c', '#4a2808', 1.7);
      const antlerM = new THREE.MeshLambertMaterial({ color: 0x5c3010 });
      for (const ax of [-0.14, 0.14]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.4, 4), antlerM);
        ant.position.set(ax, 1.35, 0); ant.rotation.z = ax * 2;
        g.add(ant);
      }
    } else if (type === 'Villager') {
      g = this._makeHumanoid('#5a3080', '#3a1a60');
    } else {
      g = this._makeHumanoid('#909090', '#555555');
    }
    g.userData.enemyType = type;
    return g;
  }

  updateEnemies(enemies) {
    const seen = new Set();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const eid = e.id != null ? e.id : i;
      seen.add(eid);
      const existing = this.enemyMeshes.get(eid);
      if (existing && existing.userData.enemyType !== e.type) {
        this.scene.remove(existing); this.enemyMeshes.delete(eid);
      }
      if (!this.enemyMeshes.has(eid)) {
        const g = this._buildEnemyMesh(e.type || 'Goat');
        this.scene.add(g);
        this.enemyMeshes.set(eid, g);
      }
      const g = this.enemyMeshes.get(eid);
      g.position.set(
        e.x / TILE_SIZE + (e.w || 28) / (2 * TILE_SIZE),
        0,
        e.y / TILE_SIZE + (e.h || 28) / (2 * TILE_SIZE)
      );
    }
    for (const [id, g] of this.enemyMeshes) {
      if (!seen.has(id)) { this.scene.remove(g); this.enemyMeshes.delete(id); }
    }
  }

  updateKids(kids) {
    const seen = new Set();
    for (const k of kids) {
      const idx = k.idx != null ? k.idx : (k.kidIdx != null ? k.kidIdx : 0);
      seen.add(idx);
      if (!this.kidMeshes.has(idx)) {
        const color = KID_COLORS[idx] || '#ff6b6b';
        const g = this._makeHumanoid(color, '#333333', 0.75);
        this.scene.add(g);
        this.kidMeshes.set(idx, g);
      }
      const g = this.kidMeshes.get(idx);
      g.position.set(
        k.x / TILE_SIZE + k.w / (2 * TILE_SIZE),
        0,
        k.y / TILE_SIZE + k.h / (2 * TILE_SIZE)
      );
    }
    for (const [idx, g] of this.kidMeshes) {
      if (!seen.has(idx)) { this.scene.remove(g); this.kidMeshes.delete(idx); }
    }
  }

  updateProjectiles(projectiles) {
    const seen = new Set();
    for (const pr of projectiles) {
      const id = pr.id ?? (pr.x * 10000 + pr.y);
      seen.add(id);
      if (!this.projMeshes.has(id)) {
        const mat = new THREE.MeshLambertMaterial({
          color: pr.type === 'arrow' ? 0xd4a830 : 0x44bb44
        });
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), mat);
        this.scene.add(m);
        this.projMeshes.set(id, m);
      }
      const m = this.projMeshes.get(id);
      m.position.set(pr.x / TILE_SIZE, 0.6, pr.y / TILE_SIZE);
    }
    for (const [id, m] of this.projMeshes) {
      if (!seen.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }
    }
  }

  // ── Camera ────────────────────────────────────────────────────────────────
  updateCamera(px, py, pw, ph) {
    const wx = px / TILE_SIZE + pw / (2 * TILE_SIZE);
    const wz = py / TILE_SIZE + ph / (2 * TILE_SIZE);
    this.camera.position.set(wx, 11, wz + 9);
    this.camera.lookAt(wx, 0, wz - 1);
  }

  // ── Day / night lighting ──────────────────────────────────────────────────
  setPhase(phase) {
    if (phase === 'night') {
      this.scene.background = new THREE.Color(0x0d1a30);
      this.scene.fog = new THREE.Fog(0x0d1a30, 12, 38);
      this.ambientLight.color.set(0x3a5a8a);
      this.ambientLight.intensity = 0.7;
      this.sunLight.color.set(0x4466cc);
      this.sunLight.intensity = 0.3;
    } else {
      this.scene.background = new THREE.Color(0x7ab8f5);
      this.scene.fog = new THREE.Fog(0x7ab8f5, 20, 60);
      this.ambientLight.color.set(0xffffff);
      this.ambientLight.intensity = 0.55;
      this.sunLight.color.set(0xfff5cc);
      this.sunLight.intensity = 0.9;
    }
  }

  // ── Render one frame ──────────────────────────────────────────────────────
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
