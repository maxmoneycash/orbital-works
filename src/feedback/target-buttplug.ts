import type { FeedbackEffect } from './types';

/**
 * Stubbed-out feedback target.
 *
 * This slot used to drive an optional third feedback target alongside the Web
 * Vibration API and WebAudio, via packages published to GitHub Packages behind
 * authentication — which made `npm install` fail with E403 for anyone without
 * a token. The dependencies are gone; this stub keeps the feedback interface
 * shape intact and reports the target as unsupported, so the project builds
 * from a clean checkout with no registry configuration.
 *
 * The UI for it is hidden when VITE_FEEDBACK_TOYS=false.
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
