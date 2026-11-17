# Shogi and Xiangqi — Design

Date: 2026-11-17
Status: Approved 2026-11-17
Builds on: [the chess design](2026-11-10-chess-design.md), which set full Shogi and Xiangqi aside as a non-goal ("possible later"). This design takes them in.

## Intent

The owner wants to play Shogi (Japanese chess) and Xiangqi (Chinese chess) on the site, against the AI and hot-seat, like the eight variants already there. Both games are built into Fairy-Stockfish and ffish.js, so the rules and a strong AI come for free; the work is presenting them and fitting them into the rest of the site.

Success: the owner can pick Shogi or Xiangqi in the Play dialog, play a full game (drops and promotion in Shogi; the river, palaces and flying general in Xiangqi) against any AI level or hot-seat, and learn both games from the tutorial.

## Goals

1. **Two new curated variants:** standard Shogi (9×9) and standard Xiangqi (9×10), in the Play dialog beside the other eight, playable against every AI level and hot-seat, with clocks, undo, saving, Edit game and the board editor, exactly as the others are.
2. **The site's own look** (owner decision, 2026-11-17: "B for both"): the checkered board and the site's piece art, not traditional kanji tiles or lined Xiangqi boards.
3. **Shogi drops:** captured pieces wait beside the board, as Seirawan's pieces in hand do, and are dropped by dragging them onto an empty square.
4. **Shogi promotion:** when a move enters, leaves or stays in the far three ranks, the player chooses in the existing choice window whether to promote; a forced promotion (a piece that could never move again) needs no choice.
5. **Xiangqi's board marks:** the river and the two palaces are shaded on the checkered board.
6. **Tutorial:** a variant page for each game, explaining what differs from chess (Shogi: drops and promotion; Xiangqi: the river, the palaces, the flying general). Every piece of both games opens a lesson, as the tutorial's coverage rule already requires.

## Non-goals

- Shogi relatives and other regional games: Minishogi, Janggi, Makruk and the like (owner: "just Shogi and Xiangqi").
- Traditional looks: kanji wedge tiles, lined Xiangqi boards, pieces on intersections (owner chose the site style).
- Shogi's byoyomi time control, or other game-specific clock rules. The existing clock presets apply.
- Shogi handicap games, or any rule options beyond the standard game Fairy-Stockfish plays.

## Anti-goals

- A Shogi or Xiangqi rule the board shows differently from the rules library (the UI never decides legality).
- A piece drawn as a lettered token or with the wrong art, or a promoted Shogi piece that looks the same as the unpromoted one.
- A drop or promotion that the player can't make with the mouse, or one the app makes without asking when there's a real choice.
- Breaking any saved game, setup or lesson of the existing eight variants.

## Decided by the owner

- Add both games, and only these two (2026-11-17).
- The site's style for both, as in mockup B (2026-11-17): Shogi's gold and silver generals, knight, lance and pawn on their wooden tiles, with the Merida king, rook and bishop; Xiangqi's chariot as the rook, the general as the king, the advisor as the fers, and the elephant, horse, cannon and soldier with their current art; the river and palaces shaded.
- The overall plan, played back in chat: "looks right, write it up".
- The sides are called White and Black, as in every other game here: White, drawn with the white pieces, moves first (2026-11-17, from the builder check). Traditionally the first mover is Black in Shogi and Red in Xiangqi; the variant pages say so.

## How it works

### Variants

- Two entries are added to the curated catalog, with ffish's names (`shogi`, `xiangqi`), their sizes, a label and a one-line blurb, so the Play dialog, the editor's base list, restore and the variant pages pick them up as they did the others.
- Drops use the existing pocket support (built for Seirawan). Shogi's pockets hold the captured pieces of each side and start empty. *My call:* pocket rows are shown from the start, so the layout doesn't jump on the first capture.

### Art

- Every piece letter of both games, promoted forms included, gets art. Art is matched by how the piece moves, the existing rule:
  - Shogi: pawn, lance, knight, silver and gold on their tiles; the king, rook and bishop in the chosen piece set; the promoted bishop as the existing dragon horse tile.
  - *My call:* a promoted pawn, lance, knight or silver moves like a gold general, so it is drawn as the gold general's tile; and the promoted rook (the dragon king, a rook that also steps one square diagonally) is drawn with the Alfaerie piece of the same move, the "bers" art the editor already uses. The builder may add a small marker to promoted gold-movers so they read as promoted; whether to is left to the builder.
  - Xiangqi: as decided above.
- The chosen piece set (Settings) draws the Shogi king, rook and bishop and the Xiangqi chariot and general, since those use the standard pieces' art.

### Tutorial

- A variant page for each game.
- The coverage test requires every start-position letter of every curated variant to open exactly one lesson, and the tutorial spec requires a lesson's highlights to be the moves the app allows. Lessons follow the existing rule, one lesson per way of moving (*my calls*, from the builder check):
  - **Shared with an existing lesson:** the Shogi gold and silver generals, lance, knight and pawn; the chariot (the Rook lesson), the horse and the cannon. The Shogi king, rook and bishop share the chess lessons.
  - **The dragon king** (promoted rook) moves exactly like the bers, so the Bers lesson gains a "Dragon King (Shogi)" card, as the dragon horse already has its lesson.
  - **New lessons on curated `xiangqi` boards** for the four Xiangqi pieces whose moves the curated game restricts: the general and the advisor (never leave the palace), the elephant (never crosses the river) and the soldier (no sideways step before crossing the river). They move differently from the editor's elephant and soldier, so they are separate lessons, written and checked like the others (four steps, puzzles proven by the solver).
  - The existing Elephant (Xiangqi) and Soldier lessons say "this app has no river"; their text changes to say the editor's piece moves freely and to point to the Xiangqi lessons for the real game.
  - Promoted Shogi pieces are not start-position letters, so they have no "Learn this piece" link of their own; the Shogi variant page explains promotion and names what each piece becomes.
- Concept material (drops, promotion, the river, the palace, the flying general) goes on the variant pages. *My call:* no separate concept lessons.

### Editor

- Both games become editor bases, **position-only** (*my call*, from the builder check): the board size is fixed, only the game's own pieces (promoted forms included) are offered, pieces in hand are set through the existing pocket controls, and there are no promotion controls. A setup is always played as the curated game from its position. *Reason:* Fairy-Stockfish ties Xiangqi's palace and river and Shogi's promotion zone to fixed squares, and the custom-variant generator writes chess-style promotion, so any custom variant would quietly break the rules (a probe showed the Shogi zone shrinking to one rank). This matches the earlier owner decision that editing keeps a variant's rules. Edit game works the same way mid-game.

## Left to the builder

- How promotion and drops look and feel in detail, within the existing choice window and pocket UI.
- Whether promoted gold-movers get a marker on their tile.
- The exact shading of the river and palaces.
- How the AI levels are tuned for each game, if at all.
- Any engine or rules findings, recorded in engine.md's Spike findings.

## Known technical gaps (found in the builder check)

These are facts about the current code that the plan must handle, not open questions:
- Drops don't exist yet: Seirawan's pockets only display pieces, and `parseUci` and `fen.ts`'s square split mishandle drop moves like `B@a2`. Drag-to-drop needs chessgroundx drop handling.
- chessgroundx draws a promoted piece (`+P`) as role `pp-piece` with a `promoted` class, which `parsePieceClass` doesn't match, so promoted pieces would get no art.
- `rule()` in pieces.ts sends every `pnbrqk` letter to the standard art, so without overrides the Shogi pawn and knight and the Xiangqi soldier, horse and elephant would be drawn as chess pieces.
- `typesOfVariant` throws on 9×9 and 9×10 boards (no probe square), and its centre-of-board probe can't measure palace- or river-bound pieces.
- ffish facts: a Shogi promotion is UCI `b2h8+`; a forced promotion is offered alone, so "no choice when forced" comes free; pawn-drop restrictions are enforced; Xiangqi SAN uses H and E for the horse and elephant while the FEN letters are `n` and `b`.
