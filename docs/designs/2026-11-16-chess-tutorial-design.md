# Tutorial — Design

Date: 2026-11-16
Status: Approved 2026-11-16
Builds on: [the chess design](2026-11-10-chess-design.md), whose "Tutorial" section this replaces and expands.

## Intent

The owner has never played fairy chess and wants to learn every fairy piece inside the app. The owner also shares the site with friends, some of whom have never played chess at all. The tutorial is how both learn: a beginner can start from "what is a chessboard", and the owner can open any fairy piece and learn how it moves, how to use it, and then prove it on puzzles.

Success: a friend who has never played can learn standard chess from the tutorial alone, and the owner can pick any piece in the editor or a variant and come away able to play it.

## Goals

1. **Two tracks plus variant pages.**
   - *Chess basics*, for complete beginners: the board, the pieces, and how a game is won; then a lesson for each standard piece; then check and checkmate, castling, en passant, promotion, and draws.
   - *Fairy pieces*: a full lesson for every fairy piece type the player can meet (owner: "Full lessons for each piece").
   - *Variants*: a page for each curated variant.
2. **Every piece lesson has the same four steps** (owner: "show me where it moves, then let me try it, then show me some basic strategies, possible followed by a few chess puzzles"):
   1. **See it:** the piece alone on a board, every square it can reach highlighted.
   2. **Try it:** the player moves the piece themselves.
   3. **Strategy:** a few short tips, each with a board position showing the idea.
   4. **Puzzles:** a few puzzles that need the piece, starting easy and building up to mate in two (owner: "start easy and build up to mate in two").
3. **Puzzles that respond.** In a multi-move puzzle the other side replies between the player's moves.
4. **Wrong moves are answered, not solved for you.** A wrong move says it's wrong. A Hint button is always available, and a hint is never shown on its own (owner: "say that it is wrong, have a hint button, but don't automatically give hints").
5. **Free navigation.** Any lesson can be opened at any time; nothing is locked (owner: "go to any lesson"). Progress only marks what's finished.
6. **Variant pages** show how the variant differs from standard chess, its starting position, its pieces (each linked to its lesson), and a "Play this variant" button (owner: "looks good").
7. **Progress is saved in the browser** (`chess.tutorial`, already reserved).
8. **Lessons are data, not code**, so a lesson can be added or fixed without writing code.

## Non-goals

- Lessons for pieces the player designs themselves (owner: "no").
- Locked or ordered progression.
- Automatic hints, or showing the solution unasked.
- Accounts or sharing progress between browsers.

## Anti-goals (failure even if it "works")

- A puzzle that is wrong: the intended answer doesn't work, or a different move also solves it and is marked wrong. The owner can't catch this by eye, since the pieces are new to them.
- A lesson that describes a move the engine doesn't allow, or misses one it does.
- The tutorial disturbing the game in progress (its moves, clock or saved state).
- A beginner meeting a term they were never taught.

## Decided by the owner

- The four-step lesson shape, and its order.
- Puzzles build up from easy to mate in two, and the other side replies.
- Wrong-move feedback plus an on-demand Hint button; no automatic hints.
- The chess basics track is for friends, some complete beginners, so it starts from zero.
- A full lesson for every piece, not just pieces in curated variants (this reverses the earlier "how it moves preview only" call).
- Any lesson can be opened at any time.
- The variant page contents above.
- Designed pieces are not in the tutorial.
- Look-alike pieces share one lesson, and the editor palette and the game link to lessons (both 2026-11-16, from the builder check).
- **Layout A** (chosen from mockups): the lesson screen matches the game screen, with the board on the left and a lesson panel on the right. The panel shows the lesson's title and track, the four steps as a row of step markers (done, current, to do), the current instruction, the feedback line, and the buttons: Hint, Restart, Next, All lessons. The lesson list is its own page, because there are too many lessons to list cleanly beside the board (owner: "A, as there are probably too many lessons to list cleanly").

## How it works

### Screens

- **Lesson list** (opened from the top bar's Tutorial button, which is enabled by this plan): cards grouped under Chess basics, Fairy pieces and Variants, each card ticked when finished. *Card grid and grouping are my call.*
- **Lesson screen:** Layout A, as above. Steps can be revisited by clicking their marker. *My call.*
- **Variant page:** the same shell, with the variant's starting position on the board.

### Puzzles

- A puzzle is a position, a goal, the moves the other side replies with, and a hint.
- Goals are ones the rules can check, so the app judges a move without guessing intent: *checkmate within N moves*, *capture a named piece within N moves*, *reach a marked square*, and for the basics lessons *castle*, *capture en passant*, *promote*, and *reach a draw (stalemate)*. *My call: a free-form goal such as "get a better position" can't be judged, so it isn't offered.*
- A puzzle takes at most two of the player's moves.
- **Puzzles are forced wins** (my call, from the anti-goal "a puzzle that is wrong"): the player's first move must achieve the goal against *every* defence, not only the written one, and it must be the only first move that does. The written reply is one of the defences that holds out longest. Because the first move is unique, the written reply always fits. On the player's last move, any move that achieves the goal is accepted, even a different mate from the one written down.
- The other side's reply is written in the lesson data, so it is the same every time. *My call: an engine reply could differ between runs.*
- The key move of a piece lesson's puzzle is made by the piece being taught. Other pieces may be on the board.

### Lessons that aren't about one piece (my call)

- The steps are data. A piece lesson has the four steps above. A concept lesson (the board, how a game is won, check and checkmate, castling, en passant, promotion, draws) has an explanation step with example boards, then puzzles using the goals above. The step markers show whatever steps the lesson has.
- The basics track opens with "How a game is won", which explains check and checkmate in plain words with an example, so the piece lessons that follow can end with mate puzzles without using an untaught word. The full "Check and checkmate" lesson comes later and goes deeper.
- A variant page counts as finished once it has been opened.

### Which rules a piece is taught under (my call)

A piece that belongs to a curated variant (for example Spartan's hoplite) is taught in that variant, so its moves match what the player meets there. Every other piece is taught in a chess-based custom setup, as the editor would play it. Where a piece behaves differently in its home game (the soldier, the janggi cannon), the lesson text says so in a sentence, and the highlighted moves are the ones the app actually allows.

### Checking the content (my call)

The owner can't verify fairy-piece content by eye, so the tests verify it with the real rules (ffish), for every lesson:
- every position is legal in its variant;
- every "See it" highlight matches the moves the rules give;
- every puzzle's first move achieves its goal against every defence;
- no other first move also solves a puzzle (so a correct move is never marked wrong);
- every written reply is legal and is among the defences that hold out longest.

### Content

- **Which fairy pieces:** every non-standard piece type the board editor offers, plus the pieces only met in curated variants (Seirawan's hawk and elephant, and Spartan's pieces). *My call on reading "each piece" as every piece a player can meet.*
- **Look-alikes share a lesson** (owner decision, 2026-11-16: "Share one lesson"). There is one lesson per way of moving, titled with every name it goes by, for example "Archbishop, also called Hawk". Every name still gets its own card in the lesson list, and the card opens the shared lesson. The commoner moves like the king but isn't royal, so its card opens the King lesson, which says so in a sentence. *That last placement is my call.* "Elephant" names three different pieces, so each lesson says which game the name comes from.
- **"Learn this piece" links** (owner decision, 2026-11-16: "Yes, add links"). Each built-in piece in the editor palette, and each piece type in the game in progress, links to its lesson. Designed pieces get no link. *Where the link sits (for example a small "?" beside the piece, or in the game's piece list) is left to the builder.*
- **Size:** about 30-plus fairy lessons and 7 or more basics lessons, each with a few strategy tips and about four puzzles, so well over a hundred puzzles. *My call:* puzzle positions may be found with the help of a dev-time search script that uses the rules to find positions with exactly one solution, then are written up by hand into lesson data.
- **Strategy tips** are written by me from general fairy-chess knowledge (piece values, typical uses). The owner can't check these by eye; the tests check only that each tip's position is legal and its highlighted squares are real moves.
- Board size per lesson: as small as shows the idea, using the custom-setup support the editor already has. *My call.*

### Progress

- `chess.tutorial` holds `{ version: 1, data: … }` with the finished lessons, and which puzzles in each lesson are solved. *My call to track puzzles too, so a half-done lesson resumes where it was.*
- A lesson counts as finished when its puzzles are solved.

### Effect on the game in progress

Opening the tutorial pauses a running clock, as the editor does, and leaves the game's moves and saved state untouched. "Play this variant" opens the Play dialog with that variant chosen, and nothing changes until the player presses Start. *My call: reuse the existing Play dialog.*

## Left to the builder

- How lesson data is laid out in files, and its exact schema.
- How "Try it" ends: free play with a Next button, or a small reach-the-square task. *My lean: a reach-the-square task, so the step has a finish.*
- How a piece is put on a board in variants that don't include it (the existing custom-variant generator is the expected route).
- What happens to fairy lessons when the engine is unavailable, following the existing "engine needed" rule wherever a lesson needs a generated variant.
- The exact wording of feedback messages and hints.
