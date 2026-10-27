/**
 * Brain data (S5): this week's work orders, memory, past weeks. Typed here until Session A's
 * `lib/screens/brain.ts` lands; work orders go live with brain B1.
 */

export type Department = "Brain" | "Research" | "Writer" | "Studio" | "Sales" | "Schedule";

export type OrderState =
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "queued" }
  | { kind: "waits_on"; what: string }
  | { kind: "waits_on_you"; count: number }
  | { kind: "stuck"; reason: string; href: string | null };

export type WorkOrder = {
  id: string;
  title: string;
  who: Department;
  due: string;
  creditsUsed: number;
  creditsBudget: number;
  state: OrderState;
  /** Child orders (a long video's brief, shorts, captions); one level of nesting per row. */
  children?: WorkOrder[];
};

export type MemoryNote = {
  id: string;
  /** "Lesson · X", "Rule · you approved", "Skip reason · Sales", "Goal · last week". */
  kind: string;
  text: string;
  source: string;
};

export type PastWeek = {
  id: string;
  week: string;
  goal: string;
  done: number;
  total: number;
  creditsUsed: number;
  creditsBudget: number;
  result: string;
};

export type BrainScreenData = {
  goal: string;
  ordersDone: number;
  ordersTotal: number;
  creditsUsed: number;
  creditsBudget: number;
  checkTime: string;
  orders: WorkOrder[];
  memory: MemoryNote[];
  pastWeeks: PastWeek[];
};

export const BRAIN_SAMPLE: BrainScreenData = {
  goal: "launch the editor",
  ordersDone: 9,
  ordersTotal: 14,
  creditsUsed: 38,
  creditsBudget: 80,
  checkTime: "18:00",
  orders: [
    {
      id: "o1",
      title: "Long video “Editor launch”",
      who: "Studio",
      due: "Thu",
      creditsUsed: 22,
      creditsBudget: 40,
      state: { kind: "running" },
      children: [
        { id: "o1a", title: "Video brief", who: "Writer", due: "Tue", creditsUsed: 1, creditsBudget: 2, state: { kind: "done" } },
        {
          id: "o1b",
          title: "3 shorts",
          who: "Studio",
          due: "Fri",
          creditsUsed: 0,
          creditsBudget: 2,
          state: { kind: "waits_on", what: "video" },
          children: [
            { id: "o1c", title: "Captions + hashtags", who: "Writer", due: "Fri", creditsUsed: 0, creditsBudget: 1, state: { kind: "waits_on", what: "shorts" } },
          ],
        },
      ],
    },
    { id: "o2", title: "5 posts", who: "Writer", due: "Mon–Sat", creditsUsed: 4, creditsBudget: 5, state: { kind: "waits_on_you", count: 1 } },
    { id: "o3", title: "Slideshow “3 ways to cut a demo”", who: "Studio", due: "Wed", creditsUsed: 0, creditsBudget: 3, state: { kind: "done" } },
    { id: "o4", title: "2 Reddit replies", who: "Sales", due: "Thu", creditsUsed: 5, creditsBudget: 5, state: { kind: "stuck", reason: "budget", href: "/app/sales" } },
    { id: "o5", title: "Sunday review", who: "Research", due: "Sun", creditsUsed: 0, creditsBudget: 3, state: { kind: "queued" } },
  ],
  memory: [
    { id: "m1", kind: "Lesson · X", text: "Demo clips in the first post of the day did better than text.", source: "From last week's results" },
    { id: "m2", kind: "Rule · you approved", text: "Don't open posts with a question.", source: "From 3 edits · Sunday" },
    { id: "m3", kind: "Skip reason · Sales", text: "Not agencies; solo founders only.", source: "You dismissed 2 threads with this" },
    { id: "m4", kind: "Goal · last week", text: "Missed: 3 of 5 posts went out (Threads disconnected).", source: "This week checks accounts first" },
  ],
  pastWeeks: [
    { id: "w43", week: "19–25 Oct", goal: "First demo video", done: 11, total: 14, creditsUsed: 61, creditsBudget: 80, result: "Missed: 3 of 5 posts went out (Threads disconnected)" },
    { id: "w42", week: "12–18 Oct", goal: "Set up accounts and voice", done: 8, total: 8, creditsUsed: 24, creditsBudget: 60, result: "Met" },
  ],
};
