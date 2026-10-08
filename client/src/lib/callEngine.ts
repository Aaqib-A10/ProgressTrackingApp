import { callsApi, type CallParticipant, type CallSignal } from './callsApi'

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
  state: RTCPeerConnectionState | 'new'
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
}

interface Peer {
  userId: string
  name: string
  pc: RTCPeerConnection
  stream: MediaStream
  initiator: boolean
  pendingIce: RTCIceCandidateInit[]
  info: CallParticipant | null
}

const POLL_MS = 1000

export class CallEngine {
  private peers = new Map<string, Peer>()
  private iceServers: RTCIceServer[] = []
  private audioTrack: MediaStreamTrack | null = null
  private camTrack: MediaStreamTrack | null = null
  private screenTrack: MediaStreamTrack | null = null
  private localStream = new MediaStream()
  private me = ''
  private timer: number | undefined
  private polling = false
  private closed = false
  private snap: CallSnapshot

  constructor(callId: string, conversationId: string, video: boolean, private onChange: (s: CallSnapshot) => void) {
    this.snap = { callId, conversationId, video, status: 'connecting', error: null, localStream: this.localStream, mic: true, cam: false, screen: false, peers: [], startedAt: Date.now(), declined: [], hadPeers: false, connectedAt: null }
  }

  get snapshot(): CallSnapshot { return this.snap }

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
        state: p.pc.connectionState,
      })),
    }
    if (this.snap.peers.length && !this.snap.hadPeers) { this.snap.hadPeers = true; this.snap.connectedAt = Date.now() }
    this.onChange(this.snap)
  }

  /** Ask for mic (and camera for video calls), join, and call everyone already there. */
  async start(): Promise<void> {
    try {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: this.snap.video ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } : false })
        this.audioTrack = s.getAudioTracks()[0] ?? null
        this.camTrack = s.getVideoTracks()[0] ?? null
      } catch {
        // Camera busy or refused: fall back to microphone only.
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true })
          this.audioTrack = s.getAudioTracks()[0] ?? null
        } catch {
          this.audioTrack = null // join anyway, listen only
        }
      }
      this.rebuildLocal()
      const j = await callsApi.join(this.snap.callId, { mic: !!this.audioTrack, cam: !!this.camTrack })
      this.me = j.me
      this.iceServers = j.iceServers
      this.emit({ mic: !!this.audioTrack, cam: !!this.camTrack, status: 'live', error: this.audioTrack ? null : 'No microphone found or permission was blocked. You can still listen.' })
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
    const peer: Peer = { userId, name, pc, stream: new MediaStream(), initiator, pendingIce: [], info }
    this.peers.set(userId, peer)
    pc.onicecandidate = (e) => { if (e.candidate) void callsApi.signal(this.snap.callId, userId, 'ice', e.candidate.toJSON()).catch(() => undefined) }
    pc.ontrack = (e) => {
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track)
      e.track.onunmute = () => this.emit()
      this.emit()
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && peer.initiator) void this.offer(peer, true)
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

  private async onSignal(s: CallSignal) {
    if (s.kind === 'bye') { this.dropPeer(s.from); return }
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
      this.emit({ declined: r.declined ?? [] })
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
    void callsApi.state(this.snap.callId, { screen: !!this.screenTrack }).catch(() => undefined)
    this.emit({ screen: !!this.screenTrack })
  }

  private stopLocal() {
    for (const t of [this.audioTrack, this.camTrack, this.screenTrack]) t?.stop()
    this.audioTrack = this.camTrack = this.screenTrack = null
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
