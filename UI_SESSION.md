# UI session charter

This file is the standing brief for a DEDICATED UI-ONLY Claude Code session on a
cheaper model (Haiku or Sonnet), so the main (Fable) session stays free for
physics/architecture. If you are that session: this is your contract.

## How the user starts you
Open a new Claude Code session in this folder → `/model` → pick Haiku or Sonnet →
say "read UI_SESSION.md and work the backlog" (CLAUDE.md loads automatically and
its Agent orientation map applies to you too).

## Scope — UI ONLY (same boundary as .claude/agents/ui-polish.md)
- YES: styling, layout, panels/cards/toolbars/chips, theming, labels, small UX
  affordances, HUD/rail/dock presentation, spacing/contrast/visibility fixes.
- NO: physics, solvers, the event/replay model, persistence logic, frozen
  calculator zones, tests' math blocks, MATH.md math content. If a backlog item
  turns out to need those, mark it BLOCKED-ESCALATE below and move on.

## Working rules
- One item at a time. `python build.py` after each ($env:Path="C:\Program Files\nodejs;$env:Path");
  gate stays green at its current count. Browser-verify per the orientation map.
- Commit per verified item: `fix(ui): <what> (UI session)` + the
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> trailer convention, push to dev.
- Keep this file updated: move items DONE with the commit hash, add anything the
  user reports directly to you.

## Backlog (user + main session feed this)
- [ ] Save-modal name prefill gap + fleet-editor 'text\plain' typos (also exists
      as a side-chip task; skip if already done — check git log).
- [ ] HUD strip: overflow behavior with 4+ vehicles (chips wrap? scroll? decide + implement).
- [ ] Plan rail: badge/selected-state polish at collapsed width.
- [ ] Patch-notes modal: 2.0.1 entry renders; check long-changelog scroll styling.
- [ ] Trade studies: sweep-variable select + metric select alignment at narrow widths.

## BLOCKED-ESCALATE (main session picks these up)
- (none yet)
