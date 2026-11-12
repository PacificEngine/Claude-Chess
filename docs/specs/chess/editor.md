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
  - set castling rights: a **Castling** box, and one box per castling right the base has (White O-O, White O-O-O, Black O-O, Black O-O-O; in Seirawan each castling right also carries gating, and each gating file has its own box, such as "Black gating on the g-file"). A right's box is enabled only while its king and rook (or, for a gating file, the king and the start piece on that file) are on their start squares; unticking it removes the right from the FEN. A new setup starts with every right of the base ticked; an edited game starts from its own rights.
    - The Castling box is the master switch: it is the generated variant's `castling` option, and while it is off the FEN has no rights and the per-right boxes are hidden. It is unavailable, and off, on a board of another size than the base's, where the rights would mean nothing.
    - *Reason (owner decision, 2026-11-12):* one box for every right could not express a game in which only one side, or one wing, may still castle.
  - set both clock times, when editing a timed game (see `./chess.md`, Edit current game)
  - set pieces in hand, for variants that have them
- **Base rules:**
  - A setup made from scratch picks a base variant from the curated list.
  - An edited game uses its current variant as the base (a custom game, its setup's base), and the base can't be changed while editing it: another base would be another game.
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
- **Saved setups** appear in the Play dialog's variant list. Save updates the setup this editor session saved first, even after a rename or a new board (owner decision, 2026-11-12).

### Must Not Do
- Allow a designed piece to be royal. Only the king, or a variant's own royal pieces, can be royal (decided in the design).
- Offer Betza modifiers in the UI that the engine spike found unsupported.
- Send any unvalidated user text into a variant definition.

## Technical Constraints
Facts from the engine spike (`./engine.md`, 2026-11-10) that shape the generator:
- **Trap: a variant name can't be redefined** in ffish.js or the engine. A later `[name]` section is refused, and the old definition stays loaded. Every generated definition is therefore named by a hash of its parent and its own text (for example `cx_<hash>`). The same setup always gets the same name, and any change gets a new one. The parent is hashed too because the same body on another base is another variant.
- **Trap: ffish.js `loadVariantConfig` never reports errors.** A section with invalid options is still added, with those options dropped. ffish.js accepting a definition therefore proves nothing. Definitions are validated with the engine's `check <path>` (one problem per line, ended by `isready`/`readyok`), and only a definition with no problems reaches ffish.js and the engine.
- **Trap: `new ffish.Board('<unknown variant>')` crashes the wasm module.** A generated variant must be loaded, and confirmed in `ffish.variants()`, before any board is created for it.
- **Slots and modifiers:** designed pieces use `customPiece1` through `customPiece25`. The Betza modifiers `m`, `c`, `p`, `g` and `n` work. **`j` is silently ignored**, so the UI never offers it.
- **`pieceToCharTable`:** the generator sets it whenever it adds piece letters, so that `check` reports nothing ("Missing piece type") for a valid setup.
- **Saved data holds the setup, not ini text.** Saved setups and saved custom games store the setup (base variant, board size, piece letters to piece types, designed-piece ids, promotion settings, FEN). The definition is regenerated and re-validated on load. Plan 1's restore rejects any stored `ini`, so raw definition text never comes back from storage.

## Security
Names and Betza strings are untrusted. The generator rejects any text that could break the variants.ini format, such as newlines, `[`, `]` or `=` inside values. One exception: the start FEN may carry a single letters-only pocket segment (`[EHeh]`) right after the board placement, and nothing else in brackets. It is matched by a strict pattern of its own, with no newline, `=` or `;` anywhere. A bracket can only open a section at the start of a line, so this can't inject one, and without it a setup with pieces in hand (Seirawan) couldn't be generated. Betza is limited to the notation's own characters. Names never enter the definition at all: they're stored only in the app's own data.

## Resilience
No external dependencies beyond the engine, whose failure modes are in `./engine.md`. If the engine rejects a definition that ffish.js accepted, the game doesn't start and the engine's error is shown.

When the engine is unavailable, the editor still works: pieces can be placed, and a setup that only changes the position of a curated variant can still be played or resumed, because it needs no generated definition. "Play" and "Resume" are disabled for a setup that needs one, with the reason shown. Editing a custom game therefore can't be resumed without the engine, since its definition always has to be checked.

## Performance & Scalability
The preview and legal-move highlighting update within 50 ms of each edit.

## Open Questions
None.
