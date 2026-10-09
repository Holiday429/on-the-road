export interface RecapUiState {
  activeRecapId: string | null;
  generating: boolean;
  /** Indices of cards the reader has turned over. Index 0 is the cover. */
  flipped: Set<number>;
  /** Cards mid-flip, so a re-render during the animation doesn't cut it short. */
  flipping: Set<number>;
  /**
   * Render each chapter as a stranger would see it (bodyPublic, with withheld
   * chapters shown as withheld). The owner previews the share before it exists,
   * rather than discovering what leaked after the fact.
   */
  publicMode: boolean;
  error: string;
  /** Per-chapter redaction reasons from the last generation. */
  privacyReport: Record<string, string[]>;
}

export function initialRecapUi(): RecapUiState {
  return {
    activeRecapId: null,
    generating: false,
    flipped: new Set<number>(),
    flipping: new Set<number>(),
    publicMode: false,
    error: '',
    privacyReport: {},
  };
}
