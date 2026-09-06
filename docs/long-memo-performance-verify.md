# Long multi-layer performance — verification matrix

Manual / TestFlight checks after safer memory & heat work (idle eviction, skip-inaudible decode, monitor-mix paging).

## Device matrix
- Mid-tier iPhone (e.g. 12/13) and iPad regular width
- Build: TestFlight Release (jetsam differs from Debug)

## Scenarios
1. **3 × ~4.5 min stack** — monitor mix on headphones; stop at end; Play immediately
2. **Stop at ~2:30 on layer 3** — Play all layers
3. **Mid-save kill** — force quit during "Saving…" after a stack take; relaunch; confirm layer recovered
4. **Lock screen** — play a long multi-layer memo; lock at 0:30; confirm audio continues (no idle PCM eviction while playing)
5. **Library scrub** — multi-layer memo row mini-waveform scroll / scrub stays smooth
6. **Unmute / clear solo mid-play** — mute one layer, Play, unmute mid-take; newly unmuted layer must sound (decode-then-resync)
7. **Pause 5s → Play** — no multi-second cold-decode hitch (idle eviction is 45s)
8. **Pause ≥45s → Play** — cold decode OK; must eventually play with sound
9. **Scrub after long pause** — playhead scrub then Play works after idle eviction
10. **Switch five long memos** — open/play/leave; watch for fewer JetsamEvent kills vs pre-eviction builds

## Logs (Xcode Organizer / Metro)
- Confirm remaining crashes are / are not `JetsamEvent`
- Dev console on listen-play: `[audio] play buffers fullPaths=… pages=… pageSec=…`
- Dev console on monitor warmup: `[audio] monitor warmup paged=… full=…`
- Dev console after long pause: `[audio] idle PCM evict before/after …`

## Expected
- Listen-play still full-decodes **audible** stems only (muted/soloed-out stay cold until unmute)
- After ~45s paused idle (not recording/arming), decoded PCM is released; Play re-decodes
- Monitor-mix for long WAV stems prefers disk pages (~tens of seconds × layers); page miss at warmup falls back to full buffer (never arms 0 sources)
- Manifest peak sidecars under `peaks/` unchanged
- Cooler *between* plays first; cooler *during* long stack monitor only when paging hits
