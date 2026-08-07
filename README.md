# Orbital Works

A satellite tracker with a spacecraft hardware and RF console bolted on.

Fork of [Satvisor](https://github.com/satvisorcom/satvisor) (AGPL-3.0), itself
derived from [TLEscope](https://github.com/aweeri/TLEscope). The 3D globe, sky
view, orrery, pass predictor, SatNOGS browser, Doppler charts, antenna rotator
control, themes and the whole draggable-window canvas are upstream's work and
are kept intact. This fork adds two windows and unblocks the build.

## Run

```bash
npm install
npm run dev      # http://localhost:1420
npm run build
```

No GitHub token required — see "Build" below for why that is worth saying.

## What this fork adds

### Anatomy
15 spacecraft modelled as parts lists over a shared 66-component library —
buses, arrays, Hall thrusters, phased arrays, laser terminals, brightness
mitigation. The 3D model is generated procedurally from the parts list rather
than loaded as a fixed mesh, so the exploded view and the mass and power
budgets all fall out of the same data. Modelled mass is shown against published
mass so divergence is visible rather than hidden. Track a satellite and the
window follows it to the matching hardware.

### Link budget
Phased-array and link modelling wired into the live tracking state. It reads
the tracked satellite and the configured observer, derives the real elevation,
slant range and off-nadir steering angle, and runs the budget against that
geometry: EIRP, free-space loss, rain, co-channel interference, achievable
modulation and rate. Push element spacing past ~0.55λ and a grating lobe
appears.

The Ku user link uses Starlink's actual OFDM waveform — 1024 subcarriers,
750 Hz frames, 4QAM and 16QAM only — not DVB-S2X. Gateway links fall back to
DVB-S2X, labelled as the assumption it is.

Both are in the command palette: `Ctrl+K` → "Anatomy" or "Link Budget".

## Build

Upstream requires a GitHub personal access token, because
`@satvisorcom/buttplug` and `@satvisorcom/buttplug-wasm` live on GitHub
Packages and GitHub demands auth for npm even on public packages. Upstream's
`VITE_FEEDBACK_TOYS=false` flag removes the *feature* but not the *dependency* —
rollup still resolves the import chain and the build fails. Tested.

So this fork drops both packages and stubs `src/feedback/target-buttplug.ts`.
Haptic and audio feedback are untouched. To restore: check that file out from
upstream, re-add the dependencies and the `.npmrc` registry line.

## Data provenance

Where SpaceX has published nothing — V3 mass, dimensions, layout — the model
says so rather than inventing a number.

- Band gains, EIRP densities, MODCOD thresholds — SpaceX FCC filings, via
  [NIS-Starlink-Video](https://github.com/noiseinspacechannel/NIS-Starlink-Video) (MIT)
- Waveform, beam counts, ground-cell geometry, brightness magnitudes — the spec
  registry in [BWX-STARLINK](https://github.com/Sleepingknight0/BWX-STARLINK) (MIT),
  tracing to UT Austin's live-signal teardown (IEEE TAES 2023)

## Licence

**AGPL-3.0**, inherited from upstream and not optional. If you deploy this
where others can use it over a network, you must offer them the complete source.
Keep the Satvisor and TLEscope credits.
