# Board Editor, Custom Variants & Piece Designer

## Overview
The board editor builds custom setups and edits games in progress. The piece designer invents new pieces. The variant generator turns either one into a Fairy-Stockfish variant definition, which both ffish.js and the engine load.

## Parent Domain
`./chess.md`

## Dependencies
- The rules adapter, for legality checks and previews.
- The engine adapter, which loads the generated definitions.
- Persistence, for saved setups and the piece library.

## Core Requirements

### Must Have
- **Editor:** board size from 5×5 to 12×10. In it you can:
  - place, move and remove any built-in or designed piece, for either color
  - set the side to move
  - set castling rights
  - set pieces in hand, for variants that have them
- **Base rules:**
  - A setup made from scratch picks a base variant from the curated list.
  - An edited game uses its current variant as the base.
  - The generated definition inherits from the base and overrides only what changed: board size, piece set, and promotion settings.
- **Custom setup defaults** (decided in the design): castling off, and pawns promote on the last rank to any non-king piece in the setup.
- **Legality gate:** "Play" and "Resume" stay disabled until ffish.js accepts the definition plus FEN and the position is legal under the base rules. Examples of illegal positions: a missing royal piece the base requires, or the side not to move being in check. The reason is shown to the player.
- **Letters:**
  - The generator keeps the base variant's piece letters, then assigns free letters to the other pieces.
  - It blocks with a clear message when it runs out of free letters, or when the setup uses more designed pieces than Fairy-Stockfish's `customPieceN` slots allow (the number is verified in the engine spike).
- **Piece designer:**
  - A piece is built from components: step or slide, a direction set (orthogonal, diagonal, or a leap such as (1,2) or (1,3)), a range, and a mode (move and capture, move only, capture only, or cannon-style capture over a screen). Existing pieces can also be combined.
  - The design is stored as a Betza string. An "advanced" box shows that string and allows editing it.
  - A live preview board highlights every square the piece can reach, using ffish.js.
  - Designed pieces have a name and a token letter. They are always drawn as lettered tokens.
- **Changing a designed piece:** when saved setups or games use the piece, the player chooses between "update everywhere" and "save as new piece."
- **Saved setups** appear in the Play dialog's variant list.

### Must Not Do
- Allow a designed piece to be royal. Only the king, or a variant's own royal pieces, can be royal (decided in the design).
- Offer Betza modifiers in the UI that the engine spike found unsupported.
- Send any unvalidated user text into a variant definition.

## Security
Names and Betza strings are untrusted. The generator rejects any text that could break the variants.ini format, such as newlines, `[`, `]` or `=` inside values. Betza is limited to the notation's own characters. Names never enter the definition at all: they're stored only in the app's own data.

## Resilience
No external dependencies beyond the engine, whose failure modes are in `./engine.md`. If the engine rejects a definition that ffish.js accepted, the game doesn't start and the engine's error is shown.

## Performance & Scalability
The preview and legal-move highlighting update within 50 ms of each edit.

## Open Questions
- Which Betza modifiers the UI can offer, and how many custom piece slots there are. These depend on the engine spike. Not blocking for the spec.
