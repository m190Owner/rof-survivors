// Peer-to-peer networking for co-op. Star topology: the room host is the answerer;
// every joiner is the offerer and connects only to the host. Game data flows over
// a WebRTC DataChannel; only the one-time handshake goes through signaling.php.
//
// Usage:
//   const net = new NetSession();
//   net.on('open',  (peerId) => ...);   // a peer's data channel is ready
//   net.on('message', (obj, peerId) => ...);
//   net.on('leave', (peerId) => ...);
//   const code = await net.host();       // host: returns the room code
//   await net.join(code);                // joiner: connects to the host
//   net.send({ ... });                   // broadcast to all connected peers

const ENDPOINT = 'signaling.php';
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }];

function randomId() {
  return 'p' + Math.random().toString(36).slice(2, 10);
}

async function api(action, params) {
  const body = new URLSearchParams({ action, ...params });
  const res = await fetch(ENDPOINT, { method: 'POST', body });
  return res.json();
}

export class NetSession {
  constructor(opts = {}) {
    // iceServers can be overridden (e.g. [] for same-machine testing); real
    // cross-network play needs STUN to discover public addresses.
    this.iceServers = opts.iceServers || STUN;
    this.peerId = randomId();
    this.code = null;
    this.isHost = false;
    this.hostId = null;
    this.conns = new Map();          // remotePeerId -> { pc, dc }
    this.handlers = { open: [], message: [], leave: [], peers: [] };
    this._poll = null;
    this._knownPeers = new Set();
  }

  on(type, fn) { (this.handlers[type] || (this.handlers[type] = [])).push(fn); return this; }
  _emit(type, ...args) { for (const fn of (this.handlers[type] || [])) fn(...args); }

  async host() {
    this.isHost = true;
    const r = await api('create', { peer: this.peerId });
    if (!r.ok) throw new Error(r.error || 'create failed');
    this.code = r.code;
    this._startPolling();
    return this.code;
  }

  async join(code) {
    this.code = code;
    const r = await api('join', { room: code, peer: this.peerId });
    if (!r.ok) throw new Error(r.error || 'join failed');
    this.hostId = r.host;
    await this._connect(this.hostId, true); // joiner offers to the host
    this._startPolling();
    return r;
  }

  // Broadcast an object to every open data channel. Skips channels whose send
  // buffer is backed up so a slow link can't choke the connection.
  send(obj) {
    const s = JSON.stringify(obj);
    for (const c of this.conns.values()) {
      if (c.dc && c.dc.readyState === 'open' && c.dc.bufferedAmount < 262144) {
        try { c.dc.send(s); } catch { /* ignore (e.g. message too large) */ }
      }
    }
  }

  peerCount() { let n = 0; for (const c of this.conns.values()) if (c.dc && c.dc.readyState === 'open') n++; return n; }

  close() {
    if (this._poll) clearTimeout(this._poll);
    this._poll = null;
    for (const c of this.conns.values()) { try { c.pc.close(); } catch { /* ignore */ } }
    this.conns.clear();
  }

  // Create a peer connection to `remoteId`. asOfferer => we create the channel + offer.
  async _connect(remoteId, asOfferer) {
    if (this.conns.has(remoteId)) return;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry = { pc, dc: null, pending: [] }; // pending = ICE candidates buffered until remoteDescription is set
    this.conns.set(remoteId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        api('signal', { room: this.code, from: this.peerId, to: remoteId, msg: JSON.stringify({ type: 'ice', candidate: e.candidate }) });
      }
    };
    // Only treat an explicit `closed` as a drop. `disconnected`/`failed` can be
    // transient during ICE negotiation and may recover — dropping on them kills
    // connections that would otherwise complete. Peer-left is detected via the
    // data channel's onclose below.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed') this._dropPeer(remoteId);
    };

    const wireChannel = (dc) => {
      entry.dc = dc;
      dc.onopen = () => this._emit('open', remoteId);
      dc.onclose = () => this._dropPeer(remoteId);
      dc.onmessage = (e) => { try { this._emit('message', JSON.parse(e.data), remoteId); } catch { /* ignore */ } };
    };

    if (asOfferer) {
      wireChannel(pc.createDataChannel('game'));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await api('signal', { room: this.code, from: this.peerId, to: remoteId, msg: JSON.stringify({ type: 'offer', sdp: offer.sdp }) });
    } else {
      pc.ondatachannel = (e) => wireChannel(e.channel);
    }
  }

  _dropPeer(remoteId) {
    const c = this.conns.get(remoteId);
    if (!c) return;
    try { c.pc.close(); } catch { /* ignore */ }
    this.conns.delete(remoteId);
    this._knownPeers.delete(remoteId);
    this._emit('leave', remoteId);
  }

  _startPolling() {
    if (this._poll) return;
    const tick = async () => {
      try {
        const r = await api('poll', { room: this.code, peer: this.peerId });
        if (r.ok) {
          this._emit('peers', r.peers || []);
          for (const m of (r.messages || [])) {
            try { await this._onSignal(m); }
            catch (e) { console.error('[net] signal handling failed', m.from, e); }
          }
        }
      } catch (e) { console.error('[net] poll failed', e); }
      this._poll = setTimeout(tick, 600);
    };
    tick();
  }

  async _onSignal(m) {
    let msg;
    try { msg = JSON.parse(m.msg); } catch { return; }
    const from = m.from;

    if (msg.type === 'offer') {
      // Host side: a joiner is connecting to us. Answer it.
      await this._connect(from, false);
      const entry = this.conns.get(from);
      await entry.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      await this._flushCandidates(entry);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      await api('signal', { room: this.code, from: this.peerId, to: from, msg: JSON.stringify({ type: 'answer', sdp: answer.sdp }) });
    } else if (msg.type === 'answer') {
      const c = this.conns.get(from);
      if (c) { await c.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }); await this._flushCandidates(c); }
    } else if (msg.type === 'ice') {
      const c = this.conns.get(from);
      if (!c) return;
      // Buffer candidates that arrive before the remote description is set,
      // otherwise addIceCandidate throws and the candidate is lost (ICE fails).
      if (c.pc.remoteDescription && c.pc.remoteDescription.type) {
        try { await c.pc.addIceCandidate(msg.candidate); } catch (e) { console.error('[net] addIceCandidate', e); }
      } else {
        c.pending.push(msg.candidate);
      }
    }
  }

  async _flushCandidates(entry) {
    const list = entry.pending;
    entry.pending = [];
    for (const cand of list) {
      try { await entry.pc.addIceCandidate(cand); } catch (e) { console.error('[net] flush addIceCandidate', e); }
    }
  }
}
