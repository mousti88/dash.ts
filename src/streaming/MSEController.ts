// ─── MSEController ────────────────────────────────────────────────────────────
// COMING IN CHAPTER 3
//
// Manages the MediaSource and its SourceBuffers.
//
// Concepts covered in Chapter 3:
//   - Creating SourceBuffers with the right MIME type + codec string
//   - appendBuffer() and the updateend event
//   - Why we need an append queue (SourceBuffer can only handle one operation
//     at a time — calling appendBuffer() while it's updating throws an error)
//   - Removing buffered data when the buffer gets too large (buffer eviction)
// ─────────────────────────────────────────────────────────────────────────────

export {};
