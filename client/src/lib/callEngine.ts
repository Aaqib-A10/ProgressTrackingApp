import { callsApi, type Caption, type CallParticipant, type CallSignal } from './callsApi'
import { createNoiseFilter, type NoiseFilter } from './noiseFilter'

/**
 * One voice/video call from this browser's point of view.
 *
 * Media goes browser to browser (a WebRTC "mesh": one connection per other person,
 * fine for up to ~6 people). PulseTrack only relays the small setup messages, by
 * polling every second. Every connection carries one audio and one video slot from
 * the start, so turning the camera or screen share on later never needs a re-setup:
 * we just swap the track in the video slot.
 */

export interface PeerView {
  userId: string
  name: string
  stream: MediaStream
  mic: boolean
  cam: boolean
  screen: boolean
  hand: boolean
  rec: boolean
  state: RTCPeerConnectionState | 'new'
  /** Not connected for a long time (usually a network that needs the relay). */
  stuck: boolean
}

export interface CallSnapshot {
  callId: string
  conversationId: string
  video: boolean
  status: 'connecting' | 'live' | 'ended' | 'error'
  error: string | null
  localStream: MediaStream
  mic: boolean
  cam: boolean
  screen: boolean
  peers: PeerView[]
  startedAt: number
  /** People who declined the ring. */
  declined: string[]
  /** True once at least one other person has been in the call with us. */
  hadPeers: boolean
  /** When the first other person connected (the call timer starts here). */
  connectedAt: number | null
  hand: boolean
  /** I am recording. */
  rec: boolean
  /** I was added to this call but am not in its chat. */
  guest: boolean
  isDirect: boolean
  meetingId: string | null
  /** AI note taker on for this call. */
  noteTaker: boolean
  captions: Caption[]
  /** People added who have not joined yet (still ringing). */
  invited: string[]
  /** Where speech becomes text for the notes: on the server (Groq) or in the browser. */
  sttMode: 'server' | 'browser'
  /** Background-noise removal on my microphone. */
  noise: 'on' | 'off' | 'unavailable'
  /** A relay (TURN) is set up on the server. */
  relay: boolean
}

export interface Reaction { emoji: string; name: string; from: string; at: number }

interface Peer {
  userId: string
  name: string
  pc: RTCPeerConnection
  stream: MediaStream
  initiator: boolean
  pendingIce: RTCIceCandidateInit[]
  info: CallParticipant | null
  /** Since when this connection has not been working (null = connected). */
  downSince: number | null
  lastRestart: number
}

const POLL_MS = 1000

export class CallEngine {
  private peers = new Map<string, Peer>()
  private iceServers: RTCIceServer[] = []
  private audioTrack: MediaStreamTrack | null = null
  /** The real microphone (audioTrack is the cleaned-up copy when the noise filter is on). */
  private rawMic: MediaStreamTrack | null = null
  private filter: NoiseFilter | null = null
  private camTrack: MediaStreamTrack | null = null
  private screenTrack: MediaStreamTrack | null = null
  private localStream = new MediaStream()
  private me = ''
  private timer: number | undefined
  private polling = false
  private closed = false
  private snap: CallSnapshot

  constructor(callId: string, conversationId: string, video: boolean, private onChange: (s: CallSnapshot) => void, private opts: { muteOnJoin?: boolean } = {}) {
    this.snap = { callId, conversationId, video, status: 'connecting', error: null, localStream: this.localStream, mic: true, cam: false, screen: false, peers: [], startedAt: Date.now(), declined: [], hadPeers: false, connectedAt: null, hand: false, rec: false, guest: false, isDirect: false, meetingId: null, noteTaker: false, captions: [], invited: [], sttMode: 'browser', noise: 'off', relay: true }
  }

  get snapshot(): CallSnapshot { return this.snap }

  /** Floating emoji reactions from others (set by the UI). */
  onReaction: ((r: Reaction) => void) | null = null
  /** Someone muted me (set by the UI). */
  onMutedBy: ((name: string) => void) | null = null

  /** My microphone track (for recording and the note taker). */
  get micTrack(): MediaStreamTrack | null { return this.audioTrack }

  /** Everyone else's sound (for recording). */
  remoteAudioTracks(): MediaStreamTrack[] {
    return [...this.peers.values()].flatMap((p) => p.stream.getAudioTracks())
  }

  private emit(patch: Partial<CallSnapshot> = {}) {
    this.snap = {
      ...this.snap,
      ...patch,
      localStream: this.localStream,
      peers: [...this.peers.values()].map((p) => ({
        userId: p.userId,
        name: p.info?.name ?? p.name,
        stream: p.stream,
        mic: p.info?.mic ?? true,
        cam: p.info?.cam ?? false,
        screen: p.info?.screen ?? false,
        hand: p.info?.hand ?? false,
        rec: p.info?.rec ?? false,
        state: p.pc.connectionState,
        stuck: p.downSince !== null && Date.now() - p.downSince > 20_000,
      })),
    }
    if (this.snap.peers.length && !this.snap.hadPeers) { this.snap.hadPeers = true; this.snap.connectedAt = Date.now() }
    // The poll runs every second; only tell the screen when something it shows changed.
    const sig = this.signature()
    if (sig === this.lastSig) return
    this.lastSig = sig
    this.onChange(this.snap)
  }

  private lastSig = ''
  private signature(): string {
    const tracks = (st: MediaStream | null) => (st ? st.getTracks().map((t) => `${t.id}:${t.enabled ? 1 : 0}:${t.readyState}`).join(',') : '')
    return JSON.stringify({
      ...this.snap,
      localStream: tracks(this.snap.localStream),
      peers: this.snap.peers.map((p) => ({ ...p, stream: tracks(p.stream) })),
    })
  }

  /** Ask for mic (and camera for video calls), join, and call everyone already there. */
  async start(): Promise<void> {
    try {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: this.snap.video ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } : false })
        this.audioTrack = s.getAudioTracks()[0] ?? null
        this.camTrack = s.getVideoTracks()[0] ?? null
      } catch {
        // Camera busy or refused: fall back to microphone only.
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
          this.audioTrack = s.getAudioTracks()[0] ?? null
        } catch {
          this.audioTrack = null // join anyway, listen only
        }
      }
      // Clean up background noise before it is sent (falls back to the plain mic if needed).
      this.rawMic = this.audioTrack
      let noise: CallSnapshot['noise'] = 'unavailable'
      if (this.rawMic) {
        this.filter = await createNoiseFilter(this.rawMic)
        if (this.filter) {
          // Always on for everyone: there is no switch for it in the call.
          this.audioTrack = this.filter.track
          this.filter.setEnabled(true)
          noise = 'on'
        }
      }
      // Joining a busy call: start muted so nobody's background noise interrupts.
      const startMuted = !!this.opts.muteOnJoin && !!this.audioTrack
      if (startMuted) this.audioTrack!.enabled = false
      this.rebuildLocal()
      const j = await callsApi.join(this.snap.callId, { mic: !!this.audioTrack && !startMuted, cam: !!this.camTrack })
      this.me = j.me
      this.iceServers = j.iceServers
      this.emit({ noise, relay: j.relay !== false })
      this.emit({ mic: !!this.audioTrack && !startMuted, cam: !!this.camTrack, status: 'live', error: this.audioTrack ? null : 'No microphone found or permission was blocked. You can still listen.', guest: !!j.guest, isDirect: !!j.isDirect, meetingId: j.meetingId ?? null, noteTaker: !!j.noteTaker, sttMode: j.sttMode ?? 'browser' })
      // The newcomer calls everyone who is already in the call.
      for (const o of j.others) await this.createPeer(o.userId, o.name, true, o)
      this.timer = window.setInterval(() => { void this.poll() }, POLL_MS)
      void this.poll()
    } catch (e) {
      this.emit({ status: 'error', error: (e as Error).message || 'Could not join the call' })
      this.stopLocal()
    }
  }

  private rebuildLocal() {
    const s = new MediaStream()
    if (this.audioTrack) s.addTrack(this.audioTrack)
    const v = this.screenTrack ?? this.camTrack
    if (v) s.addTrack(v)
    this.localStream = s
  }

  private currentVideo(): MediaStreamTrack | null {
    return this.screenTrack ?? this.camTrack
  }

  private async createPeer(userId: string, name: string, initiator: boolean, info: CallParticipant | null): Promise<Peer> {
    this.peers.get(userId)?.pc.close()
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const peer: Peer = { userId, name, pc, stream: new MediaStream(), initiator, pendingIce: [], info, downSince: Date.now(), lastRestart: 0 }
    this.peers.set(userId, peer)
    pc.onicecandidate = (e) => { if (e.candidate) void callsApi.signal(this.snap.callId, userId, 'ice', e.candidate.toJSON()).catch(() => undefined) }
    pc.ontrack = (e) => {
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track)
      e.track.onunmute = () => this.emit()
      this.emit()
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') peer.downSince = null
      else if (peer.downSince === null) peer.downSince = Date.now()
      if (pc.connectionState === 'failed') this.reconnect(peer)
      this.emit()
    }
    if (initiator) {
      const a = pc.addTransceiver('audio', { direction: 'sendrecv' })
      const v = pc.addTransceiver('video', { direction: 'sendrecv' })
      await a.sender.replaceTrack(this.audioTrack)
      await v.sender.replaceTrack(this.currentVideo())
      await this.offer(peer, false)
    }
    this.emit()
    return peer
  }

  private async offer(peer: Peer, iceRestart: boolean) {
    const o = await peer.pc.createOffer({ iceRestart })
    await peer.pc.setLocalDescription(o)
    await callsApi.signal(this.snap.callId, peer.userId, 'offer', peer.pc.localDescription?.toJSON())
  }

  /** Try again to connect to someone (new network path). Only the side that called starts it. */
  private reconnect(peer: Peer) {
    const now = Date.now()
    if (now - peer.lastRestart < 12_000) return
    peer.lastRestart = now
    if (peer.initiator) void this.offer(peer, true).catch(() => undefined)
    else void callsApi.signal(this.snap.callId, peer.userId, 'restart', null).catch(() => undefined)
  }

  private async onSignal(s: CallSignal) {
    if (s.kind === 'bye') { this.dropPeer(s.from); return }
    if (s.kind === 'mute') {
      if (this.audioTrack?.enabled) this.toggleMic()
      this.onMutedBy?.((s.data as { by?: string })?.by ?? 'Someone')
      return
    }
    if (s.kind === 'restart') {
      const p = this.peers.get(s.from)
      if (p?.initiator) { p.lastRestart = 0; this.reconnect(p) }
      return
    }
    if (s.kind === 'react') {
      const d = s.data as { emoji?: string; name?: string }
      if (d?.emoji) this.onReaction?.({ emoji: d.emoji, name: d.name ?? 'Someone', from: s.from, at: Date.now() })
      return
    }
    if (s.kind === 'offer') {
      let peer = this.peers.get(s.from)
      // Both sides called each other at the same moment: the one with the "smaller" id gives way.
      if (peer?.initiator && peer.pc.signalingState === 'have-local-offer' && this.me > s.from) return
      if (!peer || peer.initiator) peer = await this.createPeer(s.from, peer?.name ?? 'Someone', false, peer?.info ?? null)
      await peer.pc.setRemoteDescription(s.data as RTCSessionDescriptionInit)
      // Answer with our own media in the slots the caller created.
      for (const t of peer.pc.getTransceivers()) {
        t.direction = 'sendrecv'
        const kind = t.receiver.track?.kind
        if (kind === 'audio') await t.sender.replaceTrack(this.audioTrack)
        if (kind === 'video') await t.sender.replaceTrack(this.currentVideo())
      }
      const ans = await peer.pc.createAnswer()
      await peer.pc.setLocalDescription(ans)
      await callsApi.signal(this.snap.callId, s.from, 'answer', peer.pc.localDescription?.toJSON())
      await this.flushIce(peer)
      return
    }
    const peer = this.peers.get(s.from)
    if (!peer) return
    if (s.kind === 'answer') {
      if (peer.pc.signalingState === 'have-local-offer') await peer.pc.setRemoteDescription(s.data as RTCSessionDescriptionInit)
      await this.flushIce(peer)
    } else if (s.kind === 'ice') {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(s.data as RTCIceCandidateInit).catch(() => undefined)
      else peer.pendingIce.push(s.data as RTCIceCandidateInit)
    }
  }

  private async flushIce(peer: Peer) {
    const list = peer.pendingIce.splice(0)
    for (const c of list) await peer.pc.addIceCandidate(c).catch(() => undefined)
  }

  private dropPeer(userId: string) {
    const p = this.peers.get(userId)
    if (!p) return
    p.pc.close()
    this.peers.delete(userId)
    this.emit()
  }

  private async poll() {
    if (this.polling || this.closed) return
    this.polling = true
    try {
      const r = await callsApi.poll(this.snap.callId)
      if (r.ended || r.removed) { this.finish(); return }
      for (const s of r.signals) { try { await this.onSignal(s) } catch { /* one bad signal must not stop the call */ } }
      const present = new Map(r.participants.map((p) => [p.userId, p]))
      for (const [id, p] of this.peers) {
        const info = present.get(id)
        if (!info) this.dropPeer(id)
        else { p.info = info; p.name = info.name }
      }
      this.tuneBitrate()
      // A connection that keeps dropping (or never came up): try a fresh path.
      for (const p of this.peers.values()) {
        if (p.downSince !== null && Date.now() - p.downSince > 8000 && p.pc.connectionState !== 'connecting') this.reconnect(p)
      }
      this.emit({ declined: r.declined ?? [], noteTaker: !!r.noteTaker, captions: r.captions ?? [], invited: r.invited ?? [] })
    } catch {
      /* temporary network hiccup: keep polling */
    } finally {
      this.polling = false
    }
  }

  private async setVideoTrack(track: MediaStreamTrack | null) {
    for (const p of this.peers.values()) {
      const t = p.pc.getTransceivers().find((x) => x.receiver.track?.kind === 'video')
      if (t) await t.sender.replaceTrack(track).catch(() => undefined)
    }
    this.rebuildLocal()
  }

  /** Fewer pixels per person as the call grows, so everyone's upload keeps up (mesh). */
  private lastTune = ''
  private tuneBitrate() {
    const n = this.peers.size
    const kbps = this.screenTrack ? (n > 3 ? 600 : 1500) : n > 5 ? 250 : n > 3 ? 400 : 900
    const key = `${n}:${kbps}`
    if (key === this.lastTune) return
    this.lastTune = key
    for (const p of this.peers.values()) {
      const sender = p.pc.getTransceivers().find((x) => x.receiver.track?.kind === 'video')?.sender
      if (!sender) continue
      const params = sender.getParameters()
      if (!params.encodings?.length) continue
      params.encodings[0].maxBitrate = kbps * 1000
      void sender.setParameters(params).catch(() => undefined)
    }
  }

  toggleHand(): void {
    const hand = !this.snap.hand
    void callsApi.state(this.snap.callId, { hand }).catch(() => undefined)
    this.emit({ hand })
  }

  setRecording(rec: boolean): void {
    void callsApi.state(this.snap.callId, { rec }).catch(() => undefined)
    this.emit({ rec })
  }

  react(emoji: string): void {
    void callsApi.react(this.snap.callId, emoji).catch(() => undefined)
  }

  toggleMic(): void {
    if (!this.audioTrack) return
    this.audioTrack.enabled = !this.audioTrack.enabled
    void callsApi.state(this.snap.callId, { mic: this.audioTrack.enabled }).catch(() => undefined)
    this.emit({ mic: this.audioTrack.enabled })
  }

  async toggleCam(): Promise<void> {
    if (this.camTrack) {
      this.camTrack.stop()
      this.camTrack = null
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } })
        this.camTrack = s.getVideoTracks()[0] ?? null
      } catch {
        this.emit({ error: 'Could not turn on the camera. Check that no other app is using it and that the browser allows it.' })
        return
      }
    }
    if (!this.screenTrack) await this.setVideoTrack(this.camTrack)
    else this.rebuildLocal()
    void callsApi.state(this.snap.callId, { cam: !!this.camTrack }).catch(() => undefined)
    this.emit({ cam: !!this.camTrack, error: null })
  }

  async toggleScreen(): Promise<void> {
    if (this.screenTrack) {
      this.screenTrack.stop()
      this.screenTrack = null
      await this.setVideoTrack(this.camTrack)
    } else {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        const t = s.getVideoTracks()[0]
        if (!t) return
        this.screenTrack = t
        t.onended = () => { if (this.screenTrack === t) void this.toggleScreen() }
        await this.setVideoTrack(t)
      } catch {
        return // user cancelled the picker
      }
    }
    this.lastTune = ''
    this.tuneBitrate()
    void callsApi.state(this.snap.callId, { screen: !!this.screenTrack }).catch(() => undefined)
    this.emit({ screen: !!this.screenTrack })
  }

  /** Ask everyone else (or one person) to mute. */
  muteOthers(userId: string | '*'): Promise<unknown> {
    return callsApi.mute(this.snap.callId, userId)
  }

  private stopLocal() {
    for (const t of [this.audioTrack, this.rawMic, this.camTrack, this.screenTrack]) t?.stop()
    this.filter?.destroy()
    this.filter = null
    this.audioTrack = this.rawMic = this.camTrack = this.screenTrack = null
  }

  private finish() {
    if (this.closed) return
    this.closed = true
    window.clearInterval(this.timer)
    for (const p of this.peers.values()) p.pc.close()
    this.peers.clear()
    this.stopLocal()
    this.emit({ status: 'ended' })
  }

  async leave(): Promise<void> {
    const id = this.snap.callId
    this.finish()
    await callsApi.leave(id).catch(() => undefined)
  }
}
