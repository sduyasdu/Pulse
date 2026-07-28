// English help content — Help-Spec.md §3.
//
// Editorial rules, because they're easy to erode: don't restate the UI (tooltips
// do that), two sentences per idea, name things as the UI names them, and only
// document what is actually deployed (HL9) — a section ships with its feature.
import type { HelpDoc } from "./types";

export const help: HelpDoc = {
  reviewedAgainst: "2026-07",
  sections: [
    {
      id: "canvas",
      title: "The canvas",
      body:
        "Your roadmap is a 2D canvas: time runs left to right, and each box is a task. " +
        "Horizontal bands are epics — the groups you organise work into.",
      keywords: ["gantt", "timeline", "chart", "roadmap", "board", "grid", "lanes", "swimlane"],
      bullets: [
        { term: "Move a task", text: "Drag its middle. Drop it on another epic's band to move it there." },
        { term: "Change dates", text: "Drag the left or right edge." },
        { term: "Open a task", text: "Click it, then use the Details tab on the right." },
        { term: "Add a task", text: "Double-click empty canvas, or use + Task in the toolbar." },
      ],
    },
    {
      id: "effort",
      title: "Box height means work",
      body:
        "This is the part that surprises people: a box's height is not decoration. It's how much " +
        "parallel effort the task takes per day, so a tall box is heavier work than a short one of " +
        "the same length.",
      keywords: ["tall", "short", "size", "resize", "effort", "man-days", "estimate", "capacity", "workload"],
      bullets: [
        { term: "Graph Effort", text: "Working days × work per day. Drag the bottom edge to change the height." },
        { term: "Estimate Effort", text: "Follows the box's shape until you lock it with 🔒; ↺ unlocks it again." },
        { term: "Assigned Effort", text: "What the assigned people actually add up to, given their % allocation." },
        { term: "The coloured dot", text: "Green means the crew matches the estimate, red under-staffed, amber over." },
        { term: "⇥ adjust length", text: "Resizes the task so the current crew delivers the estimate exactly." },
        { term: "Weekends", text: "Excluded from effort and cost unless you turn on the weekend option for that task." },
      ],
    },
    {
      id: "navigation",
      title: "Getting around",
      body:
        "There are two different zooms, which is worth knowing before you go hunting: one scales the " +
        "whole picture, the other stretches time itself.",
      keywords: ["zoom", "bigger", "smaller", "scroll", "pan", "fit", "today", "week", "month", "density"],
      bullets: [
        { term: "Pan", text: "Drag empty canvas to scrub through time or move up and down." },
        { term: "View zoom", text: "⌘/Ctrl + scroll, or the +/− buttons. Scales everything." },
        { term: "Day width", text: "Stretches or compresses the time axis without resizing the boxes." },
        { term: "Day / week / month", text: "Changes how densely time is drawn, and what the ruler shows." },
        { term: "fit", text: "Zooms out until the whole roadmap is on screen." },
        { term: "compact", text: "Repacks epics so tasks that don't overlap in time share a row." },
      ],
    },
    {
      id: "people",
      title: "People and load",
      body:
        "The Team tab lists everyone on the Pulse. Drag a person onto a task to assign them, then set " +
        "what share of their time it takes.",
      keywords: ["assign", "resource", "team", "who", "allocation", "utilisation", "utilization", "overload", "busy"],
      bullets: [
        { term: "Assign", text: "Drag a chip from Team onto a task — that's 100% of their time by default." },
        { term: "% allocation", text: "Per person, per task, in the Details tab. 50% means half their day." },
        { term: "Capacity", text: "A person's occupation limit, set in the Capacity tab. Load above it shows red." },
        { term: "Assignment panel", text: "The bottom panel: one row per person, time-aligned with the canvas." },
        { term: "★ lead", text: "Marks who leads a task. A Task Lead can edit the tasks they lead." },
      ],
    },
    {
      id: "costs",
      title: "Costs",
      body:
        "Switch the bottom panel to Cost to see what the roadmap costs over time. AI spend is recorded " +
        "per task; people cost is worked out from assignments and hourly rates.",
      keywords: ["money", "budget", "price", "salary", "pay", "rate", "hourly", "tokens", "ai", "spend", "timesheet", "hours", "usd", "dollars"],
      bullets: [
        { term: "AI costs", text: "Add them on a task in the Details tab: tokens and what was spent." },
        { term: "Unit cost", text: "Worked out from what you entered, not from a price list — so it's your real rate." },
        { term: "People costs", text: "Hours × hourly cost, where hours come from the assignment and the task's length." },
        { term: "Hourly rates", text: "Set in the Capacity tab. Visible to Pulse admins only, like the costs derived from them." },
        { term: "The Cost view", text: "Group by model, person or task; switch between $ and quantity; totals are all-time." },
        { term: "A caveat", text: "AI figures are what was spent; people figures are what the plan implies. It's an estimate, not accounting." },
      ],
    },
    {
      id: "plan",
      title: "Plan vs. actual",
      body:
        "Freeze what you originally promised, then watch reality move away from it.",
      keywords: ["baseline", "delay", "late", "slip", "original", "promised", "deadline"],
      bullets: [
        { term: "📌 set plan", text: "Saves the task's current dates as its baseline." },
        { term: "Delays", text: "Draws the baseline as a dashed bar under each task, with day-count deltas." },
        { term: "Recovered", text: "Shown when a late start is clawed back by the delivery date." },
      ],
    },
    {
      id: "collab",
      title: "Working together",
      body:
        "Share a Pulse with a link, and everyone sees changes as they happen.",
      keywords: ["invite", "share", "permission", "role", "viewer", "editor", "owner", "comment", "mention", "history", "who changed"],
      bullets: [
        { term: "Invite", text: "Create a link and send it. The role you pick is what joiners get." },
        { term: "Owner / Editor", text: "Owner manages people and settings; Editor changes everything else." },
        { term: "Full Viewer", text: "Reads the whole Pulse and can comment, but can't change anything." },
        { term: "My-Beat Viewer", text: "Sees only the tasks their own resource is assigned to." },
        { term: "Task Lead", text: "Edits just the tasks they lead, reads the rest." },
        { term: "Comments", text: "On any task, with @ to mention a person or link a task." },
        { term: "Activity", text: "A durable log of who changed what, and when." },
      ],
    },
    {
      id: "board",
      title: "Board, filters and undo",
      body:
        "The same tasks, seen as a board instead of a timeline — plus the tools for finding things and " +
        "taking mistakes back.",
      keywords: ["kanban", "status", "column", "search", "filter", "undo", "redo", "mistake", "ctrl z"],
      bullets: [
        { term: "Board view", text: "Kanban columns by status. Drag a task between them to change its status." },
        { term: "Statuses", text: "Editable per Pulse. Done is always last and locks the task." },
        { term: "Filters", text: "By text, status or epic. Non-matching tasks dim rather than disappear." },
        { term: "My Beat", text: "Narrows everything to the tasks you're on." },
        { term: "Undo / redo", text: "⌘Z and ⇧⌘Z (Ctrl on Windows). Covers edits, moves and deletions." },
      ],
    },
  ],
};
