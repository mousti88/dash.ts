// ─── BufferManager ────────────────────────────────────────────────────────────
// COMING IN CHAPTER 4
//
// Drives the main streaming loop:
//   - Polls how many seconds are buffered ahead of the playhead
//   - Decides when to fetch the next segment (target buffer level)
//   - Coordinates SegmentLoader and MSEController
//   - Reports buffer health events to the rest of the player
// ─────────────────────────────────────────────────────────────────────────────

export {};
