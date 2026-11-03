/*
 * Team voice chat — WebRTC peer-to-peer audio (mesh, max 4 peers per team),
 * signalled through the game socket. Push-to-talk (V / mic button) or open mic.
 * Audio never touches the game server: it flows directly between players.
 */
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export class Voice {
  constructor(game) {
    this.g = game;
    this.peers = new Map();       // playerId -> { pc, audio }
    this.stream = null;
    this.active = false;
    this.talking = false;
    this.openMic = false;
    this.volume = 1;
    this.onStatus = () => {};
  }

  get supported() { return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  send(to, sig) { if (this.g.net) this.g.net.emit('rtc', { to, sig }); }

  async start() {
    if (this.active || !this.supported || !this.g.net) return;
    this.active = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.applyMic();
      this.onStatus(this.openMic ? 'Mikrofon açık' : 'Bas-konuş hazır');
    } catch (e) {
      this.stream = null;
      this.onStatus('Mikrofon izni yok — sadece dinliyorsun');
    }
    if (!this.active) { this.stopTracks(); return; }
    this.send('team', { type: 'hello' });
  }

  stop() {
    if (!this.active) return;
    this.send('team', { type: 'bye' });
    for (const id of [...this.peers.keys()]) this.close(id);
    this.stopTracks();
    this.active = false;
    this.setTalking(false);
  }
  restart() { if (this.active) { this.stop(); setTimeout(() => this.start(), 300); } }

  stopTracks() { if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; } }

  close(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch (e) { /* ignore */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    this.peers.delete(id);
  }

  connect(id, offerer) {
    this.close(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.volume = this.volume;
    document.body.appendChild(audio);
    if (this.stream) for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => { if (e.candidate) this.send(id, { type: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      const p = audio.play(); if (p && p.catch) p.catch(() => {});
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.close(id); };
    this.peers.set(id, { pc, audio });
    if (offerer) {
      (async () => {
        try {
          const o = await pc.createOffer();
          await pc.setLocalDescription(o);
          this.send(id, { type: 'offer', sdp: o.sdp });
        } catch (e) { this.close(id); }
      })();
    }
    return pc;
  }

  async onSignal(msg) {
    if (!this.active || !msg || !msg.sig) return;
    const { from, sig } = msg;
    try {
      if (sig.type === 'hello') { this.connect(from, true); return; }      // newcomer: we call them
      if (sig.type === 'bye') { this.close(from); return; }
      let p = this.peers.get(from);
      if (sig.type === 'offer') {
        const pc = this.connect(from, false);
        await pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        this.send(from, { type: 'answer', sdp: ans.sdp });
      } else if (sig.type === 'answer' && p) {
        await p.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
      } else if (sig.type === 'ice' && p && sig.c) {
        await p.pc.addIceCandidate(sig.c);
      }
    } catch (e) { /* stale / out-of-order signalling: ignore */ }
  }

  applyMic() {
    const on = this.openMic || this.talking;
    if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = on;
  }
  setTalking(on) {
    if (this.talking === on) return;
    this.talking = on;
    this.applyMic();
    if (this.g.net && this.stream) this.g.net.emit('talk', on || this.openMic);
  }
  setOpenMic(on) {
    this.openMic = on;
    this.applyMic();
    if (this.g.net && this.stream) this.g.net.emit('talk', on);
  }
  setVolume(v) {
    this.volume = v;
    for (const p of this.peers.values()) if (p.audio) p.audio.volume = v;
  }
  get peerCount() { let n = 0; for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++; return n; }
}
