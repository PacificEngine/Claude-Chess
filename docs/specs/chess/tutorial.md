# Tutorial

## Overview
The tutorial teaches chess from zero and every fairy piece the player can meet. Lessons are data that the tests check against the real rules, so a lesson can't teach a move the app doesn't allow, and a puzzle can't have a wrong or second answer. The design and its reasons are in `docs/designs/2026-11-16-chess-tutorial-design.md`.

## Parent Domain
`./chess.md`

## Dependencies
- The rules adapter (ffish), for highlights, legality, goal checks and the content tests.
- The variant generator (`./editor.md`), to put a piece on a board in a chess-based setup.
- The engine's `check`, wherever a lesson needs a generated variant (the existing "engine needed" rule).
- Persistence, for `chess.tutorial`.
- The session, so the tutorial can pause the game in progress and "Play this variant" can start a new one.

## Personas
- **The owner**, who has never played fairy chess and wants to learn every piece.
- **Friends the owner shares the site with**, some of whom have never played chess.

## Core Requirements

### Must Have
- **Tracks:** Chess basics, Fairy pieces, and a page for each curated variant.
  - Chess basics opens with "How a game is won", which explains check and checkmate in plain words, then a lesson for each standard piece, then Check and checkmate, Castling, En passant, Promotion and Draws.
    - *Reason:* the piece lessons end with mate puzzles, and a beginner must not meet a word they were never taught.
  - Fairy pieces has a full lesson for every non-standard piece type the editor offers, plus the pieces met only in curated variants (owner decision, 2026-11-16: "Full lessons for each piece").
- **Piece lessons** have four steps, in this order (owner decision, 2026-11-16):
  1. See it: the piece alone, every reachable square highlighted.
  2. Try it: the player moves the piece.
  3. Strategy: a few tips, each with a board.
  4. Puzzles: easy first, building up to mate in two.
- **Concept lessons** (the board, check and checkmate, castling, en passant, promotion, draws) have an explanation step with example boards, then puzzles. The step markers show the lesson's own steps.
- **Shogi and Xiangqi** (2026-11-17): a variant page for each explains what differs from chess (Shogi's drops and promotion and what each piece becomes; Xiangqi's river, palaces and flying general) and the traditional names for the sides. Pieces whose moves match an existing lesson share it: the Shogi generals, lance, knight and pawn, the chariot (Rook), the horse and the cannon; the dragon king is a "Dragon King (Shogi)" card on the Bers lesson. The Xiangqi general, advisor, elephant and soldier, which the curated game confines to the palace or the river, get their own lessons on curated `xiangqi` boards; the editor's elephant and soldier lessons say their piece moves freely and point to those. The game's pieces take the "(Xiangqi)" cards ("General (Xiangqi)" and so on), and the editor's two are "Elephant (editor)" and "Soldier (editor)", so a player who opens the elephant from a Xiangqi game gets the real game's lesson (Plan 5 ruling, 2026-11-17). Promoted Shogi pieces have no link of their own.
- **Look-alikes share a lesson** (owner decision, 2026-11-16). There is one lesson per way of moving, titled with every name it goes by. Every name has its own card, and the card opens the shared lesson.
  - The commoner's card opens the King lesson, which says the commoner isn't royal.
  - "Elephant" is three different pieces, so each lesson names the game its elephant comes from.
- **Which rules a piece is taught under:** a piece from a curated variant is taught in that variant. A piece is taught on its curated variant's boards only when no editor piece type moves the same way; a look-alike of an editor type shares that type's lesson and its chess-based boards, for example the fers-alfil (Shako's elephant), the bers (Spartan's general) and the archbishop (the warlord). Every other piece is taught in a chess-based custom setup, as the editor plays it. Where a piece differs in its home game (soldier, janggi cannon), the lesson text says so; the highlights are always the moves this app allows.
- **Puzzles:**
  - Goals are checkable by the rules: checkmate, capture a named piece, reach a marked square, castle, capture en passant, promote, and reach stalemate. Each goal must be met within N of the player's moves, with N at most 2.
  - The first move must achieve the goal against every defence, and it must be the only first move that does.
  - On the last move, any move that achieves the goal is accepted.
  - The other side's reply is written in the data, and it must be one of the defences that holds out longest.
  - In a piece lesson, the key move is made by the piece being taught.
- **Feedback:** a wrong move is undone and the panel says it's wrong. A Hint button is always shown. A hint appears only when it is pressed (owner decision, 2026-11-16).
- **Navigation:** any lesson opens at any time; nothing is locked (owner decision, 2026-11-16). A step can be revisited by clicking its marker.
  - Once the last puzzle of a lesson is solved, Next reads "Next lesson" and opens the next lesson in its track's list (owner request, 2026-11-16). A lesson with two cards in that list counts once, and another track's lesson in the list (the King lesson's Commoner card among the fairy pieces) is passed over, so Next never leaves the track. After a track's last lesson, Next stays off.
- **Layout A** (owner decision, 2026-11-16): board on the left; a lesson panel on the right with the title and track, the step markers, the instruction, the feedback line, and Hint, Restart, Next and All lessons. The lesson list is its own page of cards grouped by track, each ticked when finished.
- **Variant pages:** how the variant differs from chess, its starting position, its pieces (each linked to its lesson), and Play this variant. A page counts as finished once opened.
- **"Learn this piece" links** (owner decision, 2026-11-16): each built-in piece in the editor palette, and each piece type in the game in progress, links to its lesson. Designed pieces have none. No route into the tutorial throws away unsaved work: the top bar's Tutorial does nothing while the piece designer is open or the editor is in Edit current game, and in Edit current game the palette shows no links.
- **Progress:** `chess.tutorial` holds `{ version: 1, data }`, recording finished lessons and the solved puzzles of each lesson, so a half-done lesson resumes where it was. A lesson is finished when its puzzles are solved. A corrupt value is moved aside with a banner, like every other store.
- **The game in progress:** opening the tutorial pauses a running clock, as the editor does, and changes nothing else. Play this variant opens the Play dialog with that variant chosen; nothing changes until the player presses Start.
- **Content checks** (tests, with the real rules, for every lesson):
  - every position is legal in its variant
  - every See it highlight equals the rules' moves for that piece
  - every puzzle meets the puzzle rules above
  - every strategy board is legal, and its highlighted squares are real moves

### Must Not Do
- Show a hint, or the solution, without being asked.
- Lock lessons or force an order.
- Include designed pieces (owner decision, 2026-11-16).
- Change the game in progress, its clock times, or `chess.game`, except through Play this variant after the player confirms.
- Reply to a puzzle move with the engine. *Reason:* an engine reply can differ between runs and leave the lesson's line.

## Technical Constraints
- Lessons are data, not code. Adding or fixing a lesson must not need a code change.
- The tutorial's puzzle and highlight logic lives outside the UI, so the content tests can run it without a DOM, following the existing layer rule.
- *Trap:* strategy tips are written from general fairy-chess knowledge. The tests prove the boards are legal, not that the advice is good, and the owner can't check it by eye.
- *Trap:* puzzle positions for weak pieces (fers, wazir, alfil, shogi pawn) are hard to find by hand. A dev-time search script may propose positions, but every puzzle that ships passes the content tests.

## Security
Lesson text is shipped by the site, not typed by players, but it is still rendered as text only, never as HTML.

## Resilience
No external dependencies beyond those of `./chess.md`. When the engine is unavailable, lessons that need a generated variant are disabled with `ENGINE_NEEDED_MESSAGE`; lessons on built-in variants still work, since they need only the rules.

## Performance & Scalability
A lesson opens without a noticeable delay. The content tests do an exhaustive search for every puzzle (two player moves deep), and must stay fast enough to run in the normal unit suite.

## Open Questions
None.
