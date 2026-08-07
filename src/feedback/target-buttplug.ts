import type { FeedbackEffect } from './types';

/**
 * FORK NOTE — stubbed out.
 *
 * Upstream satvisor drives an optional third feedback target (alongside the
 * Web Vibration API and WebAudio) through @satvisorcom/buttplug. Those two
 * packages are published to GitHub Packages behind authentication, so a plain
 * `npm install` of the upstream repo fails with E403 for anyone without a
 * token. This stub keeps the feedback interface and UI intact while reporting
 * the target as unsupported, so the fork builds from a clean checkout.
 *
 * To restore: `git checkout upstream/main -- src/feedback/target-buttplug.ts`,
 * re-add the two dependencies and the @satvisorcom .npmrc registry line.
 */
export interface ButtplugDeviceInfo {
  name: string;
  index: number;
  battery: number | null;
}

export class ButtplugTarget {
  onStatusChange: ((status: string) => void) | null = null;
  onDevicesChange: ((devices: ButtplugDeviceInfo[]) => void) | null = null;

  isSupported(): boolean { return false; }
  get connected(): boolean { return false; }
  get devices(): ButtplugDeviceInfo[] { return []; }
  async init(): Promise<void> { throw new Error('haptic device target not built into this fork'); }
  async scan(): Promise<void> {}
  fire(_effect: FeedbackEffect): void {}
  stopAll(): void {}
  async disconnect(): Promise<void> {}
  dispose(): void {}
}
