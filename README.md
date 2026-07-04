# 99 Nights in the Forest

A survival game rendered in 3D (three.js): survive 99 nights, gather resources,
build defenses, and rescue the 4 lost kids. Play solo in the browser or online
with up to 4 players.

## Run

```bash
npm install
npm start
# open http://localhost:3000
```

Solo mode also works by opening `index.html` directly (multiplayer then
connects to `localhost:3000` if the server is running).

## Controls

| Key | Action |
|---|---|
| WASD / Arrow keys | Move |
| Space | Attack / use selected item |
| E | Interact — gather, rescue kid, place item, open chest |
| O | Open crafting menu (near the crafting table) |
| Enter | Go through a door |
| 1–6 | Select hotbar slot |
| Esc | Close crafting / leave online game |

Touch controls (D-pad + action buttons) appear on tablets/phones.

## Gameplay

- **Day (90s):** gather wood, stone, herbs and berries; craft walls, doors,
  traps, farms, weapons.
- **Hunger:** the food bar drains constantly — eat berries (bushes, chests,
  farms) or you'll starve and lose HP.
- **Night (60s):** goats attack — more every 10 nights.
- **The kids are trapped inside the 4 corner mines**, each guarded by goats.
  Walk into the cave mouth, defeat the guards, rescue the kid ([E]) and lead
  them home. **Rescuing a kid** triggers 10 waves of angry villagers.
- **Night 50:** the Warden awakens. Defeat it and it retreats… but returns
  3 nights later, enraged.
- **Win:** survive 99 nights with all 4 kids rescued.

## Multiplayer

Sign up in-game, create or join a lobby (max 4 players). The server is
authoritative (20 ticks/s); progress auto-saves at dawn and when the last
player leaves, and the host's save is restored when they create a new lobby.

Deploying (Railway/Render): set the `JWT_SECRET` environment variable —
the server refuses to start in production without it.

## Project layout

- `index.html`, `styles.css`, `src/` — client (canvas HUD + three.js world)
- `server/` — Express + WebSocket game server, JSON file storage
  (`server/gamedata.json`, git-ignored)
