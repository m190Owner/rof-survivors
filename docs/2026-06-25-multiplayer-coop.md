# Multiplayer Co-op (RoF Survivors)

Status: Phase 1 in progress (2026-06-25).

## Goal
Real-time co-op (2–4 friends, same arena vs the same horde) with **no VPS** — browsers
connect peer-to-peer via WebRTC; the handshake is brokered by a small PHP script on the
existing host. One player is the **host** and runs the authoritative simulation.

## Constraints / honest limits
- Signaling runs on the existing PHP host (`game/signaling.php`); game data is pure P2P.
- ~10–20% of strict-NAT/CGNAT players can't connect P2P without a TURN relay (a server we
  don't have). Co-op works for most home networks, not all. Public STUN handles the rest.
- Bandwidth: syncing hundreds of entities caps practical play at 2–4 players.

## Topology
**Star / host-authoritative.** The room creator is the host. Each joiner does a WebRTC
handshake with the host only (not a full mesh). The host relays/broadcasts state to all
joiners. This matches Phase 2 (host runs the sim) so no rework later.

## Components
- **`game/signaling.php`** — HTTP polling mailbox. Per 4-char room code it stores short-lived
  signaling messages (SDP offer/answer, ICE candidates) addressed peer→peer, plus a peer
  list. Actions: `create`, `join`, `signal` (post a message), `poll` (fetch+clear my
  messages), `peers`. JSON files under `game/data/` (gitignored), rooms expire (~2 min idle).
- **`src/net.js`** — wraps `RTCPeerConnection` + a DataChannel over `signaling.php`. API:
  `host()` → room code; `join(code)`; `send(obj)`; `onMessage(cb)`; `onPeer(cb)` /
  `onPeerLeave(cb)`. Host keeps one connection per joiner; `send` broadcasts; messages from a
  joiner can be relayed to others by the host. Uses public STUN (`stun:stun.l.google.com:19302`).
- **Lobby UI** (`index.html` + `ui.js`) — a screen with **Host** (shows room code) and
  **Join** (enter code) plus a connected-player list and a **START** button (host only).
- **Shared movement** (`game.js`) — Phase 1 slice: players spawn in a shared *empty* arena
  (no enemies). Each player simulates its own movement and sends its position+character to the
  host every ~50ms; the host broadcasts the full player roster; everyone renders remote
  players (interpolated). Each player keeps its own camera.

## Phase 1 acceptance (vertical slice)
- Two browsers join the same room code and **see each other's operators move in real time**
  in an empty arena. No enemies, no combat yet.
- Proves: PHP signaling, WebRTC connection across the network, position sync + remote-player
  rendering, join/leave handling.

## Out of scope for Phase 1 (later phases)
- Phase 2: host runs the shared horde (enemies/spawner/bosses/biomes) and syncs it.
- Phase 3: non-blocking level-ups, downed+revive teammates, player-count difficulty scaling,
  disconnect/host-migration, co-op leaderboard.

## Testing
- `signaling.php`: curl the actions against a local PHP server (create/join/signal/poll/peers).
- `net.js`: in-page loopback — two `RTCPeerConnection`s in one tab connecting through
  `signaling.php` — verify the DataChannel opens and messages round-trip. True cross-network
  verification needs two real browsers (manual).
