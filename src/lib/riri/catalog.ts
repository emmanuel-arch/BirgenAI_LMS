// ─────────────────────────────────────────────────────────────────────────────
// The semantic layer — what a lender's words MEAN, in SQL.
//
// Before this file, Riri's numbers were thirteen hand-written Prisma queries. They
// were correct, but they were opaque (nobody could see what "PAR 30" was actually
// counting), they were fixed (there was no way to ask for the same number sliced by
// product), and they were a second definition of measures the dashboard already
// computed its own way — two sources of truth, one drift away from a lender being
// told two different PARs by two parts of the same console.
//
// A metric here is a DEFINITION, not a query: a name, the words lenders use for it,
// a plain-English statement of what it counts, and the SQL that counts it. Everything
// else — a time range, a slice by product, a top-N — is composed onto the definition
// by `compile()` rather than written out again. That is what makes "collected this
// month" and "collected by product last quarter" the same metric asked two ways.
//
// WHY THE CATALOGUE IS CODE (and MetricDefinition is only an overlay): the same
// reasoning as the billing price book. What PAR 30 means is a decision that should
// move through a diff, a review and a deploy — it is the number a lender reports to
// a regulator. What belongs to the lender is how they SPEAK about it (their own
// words, their own target), and that is the row in the database. A metric that does
// not exist here cannot be quoted, targeted, routed to, or invented by a language
// model — the same "AVAILABLE_FEATURES" discipline the billing integrity pass
// established, applied to numbers instead of features.
//
// Every metric compiles to a statement over the published views (riri-views.sql),
// runs through the same guard as model-written SQL (guard.ts) on the same read-only
// path (readpath.ts), and is SHOWN to the person who asked.
// ─────────────────────────────────────────────────────────────────────────────

export type MetricUnit = "KES" | "count" | "percent" | "score";
export type DimensionId = "product" | "borrower" | "officer" | "status" | "channel" | "kyc_status" | "risk_band" | "month";

/** How a metric is sliced. Each metric declares the slices its own data can support. */
export type DimensionSpec = {
  label: string;
  /** JOINs this slice needs, appended to the metric's FROM. */
  join?: string;
  /** The expression grouped on. */
  group: string;
  /** What the row is called in the answer. */
  name: string;
};

export type MetricSpec = {
  id: string;
  label: string;
  unit: MetricUnit;
  /** The definition, in the words a lender would use. Shown in the catalogue. */
  description: string;
  /** Words their staff say when they mean this. The router matches on these. */
  synonyms: string[];
  from: string;
  /** The aggregate that produces the number. */
  value: string;
  /** A secondary count for the sentence ("… across 12 loans"). */
  countExpr?: string;
  /** What that count is a count OF. Riri says "across 12 payments", not "across 12". */
  countNoun?: string;
  where?: string;
  /**
   * The column a time range filters on. A STOCK metric (a balance right now) has
   * none — "outstanding book this month" is not a sentence, and answering it as if
   * it were would be a wrong number delivered confidently.
   */
  timeColumn?: string;
  /**
   * The period assumed when the question names none. Money FLOWS default to the
   * current month ("how much did we collect" means this month). Populations do not:
   * "how many borrowers do I have" means all of them, and answering with the count
   * created since the 1st would be a wrong number to a reasonable question.
   */
  defaultRange?: "month" | "all";
  dimensions?: Partial<Record<DimensionId, DimensionSpec>>;
  /** Which way is good — drives the target chip and the tone of an answer. */
  goodDirection?: "up" | "down";
  /**
   * How much to trust a match on this metric's words when another metric also
   * matches. Default 1. Raised only for metrics whose vocabulary is entirely made of
   * NARROWING words: "how many applications are waiting" contains the broad noun
   * ("applications") and the qualifier ("waiting"), and the qualifier is the part
   * that says what was actually asked. Without this, the broad metric wins on word
   * length alone and answers a question nobody asked.
   */
  specificity?: number;
};

// ── Shared SQL fragments ──────────────────────────────────────────────────────
//
// $1 is always the org. RLS already guarantees a query cannot cross a tenant, so
// this predicate is redundant — and it stays anyway. Two independent reasons must
// fail before one lender sees another's book, and a redundant WHERE clause is a
// cheap second reason. It also makes the SQL we SHOW the lender self-evidently
// scoped, which is worth something to the person reading it.
const ORG = (a: string) => `${a}.org_id = $1`;

/** A loan is "in arrears past N days" if any installment is overdue past that date. */
const OVERDUE_BEFORE = (loanAlias: string, param: string) =>
  `exists (select 1 from riri_installments i where i.loan_id = ${loanAlias}.id and i.status = 'OVERDUE' and i.due_date < ${param})`;

const PRODUCT_OF_LOAN: DimensionSpec = {
  label: "Product",
  join: "join riri_products p on p.id = l.product_id",
  group: "coalesce(p.name, 'Unknown product')",
  name: "Product",
};

// ── The catalogue ─────────────────────────────────────────────────────────────

export const METRICS: MetricSpec[] = [
  {
    id: "olb",
    label: "Outstanding book",
    unit: "KES",
    description:
      "The money your borrowers still owe you: the balance of every loan that is currently active. It does not include loans you have already cleared or written off.",
    synonyms: [
      "olb", "outstanding", "loan book", "portfolio", "book size", "how big is my book",
      "total outstanding", "gross loan portfolio", "balance", "exposure", "concentration",
    ],
    from: "riri_loans l",
    where: "l.status = 'ACTIVE'",
    value: "coalesce(sum(l.balance), 0)",
    countExpr: "count(*)",
    countNoun: "active loans",
    dimensions: {
      product: PRODUCT_OF_LOAN,
      borrower: { label: "Borrower", join: "join riri_borrowers b on b.id = l.borrower_id", group: "coalesce(b.name, 'Unnamed borrower')", name: "Borrower" },
      officer: { label: "Booked by", join: "left join riri_staff s on s.id = l.created_by", group: "coalesce(s.name, 'Portal / system')", name: "Booked by" },
    },
  },
  {
    id: "active_loans",
    label: "Active loans",
    unit: "count",
    description: "How many loans are currently running — disbursed, not yet cleared.",
    synonyms: ["active loans", "running loans", "how many loans", "open loans", "live loans"],
    from: "riri_loans l",
    where: "l.status = 'ACTIVE'",
    value: "count(*)",
    dimensions: {
      product: PRODUCT_OF_LOAN,
      officer: { label: "Booked by", join: "left join riri_staff s on s.id = l.created_by", group: "coalesce(s.name, 'Portal / system')", name: "Booked by" },
    },
  },
  {
    id: "at_risk",
    label: "Value at risk (PAR 30)",
    unit: "KES",
    description:
      "The full outstanding balance of every active loan that has an installment more than 30 days overdue. The whole balance counts, not just the late installment — that is the international convention, and it is deliberately unflattering.",
    synonyms: ["at risk", "value at risk", "par amount", "portfolio at risk amount", "how much is at risk"],
    from: "riri_loans l",
    where: `l.status = 'ACTIVE' and ${OVERDUE_BEFORE("l", "$2")}`,
    value: "coalesce(sum(l.balance), 0)",
    countExpr: "count(*)",
    countNoun: "loans in arrears",
    goodDirection: "down",
    dimensions: { product: PRODUCT_OF_LOAN },
  },
  {
    id: "par30",
    label: "PAR 30",
    unit: "percent",
    description:
      "Value at risk as a share of your outstanding book — the single number that says how much of what you are owed is going wrong. Under 5% is healthy; over 10% needs a collections push.",
    synonyms: ["par", "par 30", "par30", "portfolio at risk", "arrears rate", "delinquency", "delinquency rate", "npl", "non performing"],
    from: "riri_loans l",
    where: "l.status = 'ACTIVE'",
    value: `100.0 * coalesce(sum(case when ${OVERDUE_BEFORE("l", "$2")} then l.balance else 0 end), 0) / nullif(sum(l.balance), 0)`,
    goodDirection: "down",
    dimensions: { product: PRODUCT_OF_LOAN },
  },
  {
    id: "arrears",
    label: "Arrears",
    unit: "KES",
    description: "The money that is actually late right now: the unpaid part of every overdue installment. Smaller than value-at-risk, because it counts the missed installments rather than the whole loan behind them.",
    synonyms: ["arrears", "overdue", "late money", "past due", "missed installments", "how much is late"],
    from: "riri_installments i",
    where: "i.status = 'OVERDUE'",
    value: "coalesce(sum(i.amount_outstanding), 0)",
    countExpr: "count(*)",
    countNoun: "overdue installments",
    goodDirection: "down",
  },
  {
    id: "due_today",
    label: "Due today",
    unit: "KES",
    description: "What is falling due today and has not been paid yet — the collections target for the day.",
    synonyms: ["due today", "expected today", "collections target", "what is due", "due now"],
    from: "riri_installments i",
    where: "i.due_date::date = current_date and i.status <> 'PAID'",
    value: "coalesce(sum(i.amount_outstanding), 0)",
    countExpr: "count(*)",
    countNoun: "installments",
  },
  {
    id: "disbursed",
    label: "Disbursed",
    unit: "KES",
    description: "Money that actually left your float and reached a borrower — confirmed disbursements only, whether sent by M-Pesa B2C or confirmed manually.",
    // Both stems: a lender says "disbursed" and "disbursements", and the router
    // matches whole words — "disbursed" is not a substring of "disbursements".
    synonyms: ["disbursed", "disbursement", "disbursements", "paid out", "lent", "lending", "loaned out", "payout", "money out", "how much did we lend"],
    from: "riri_disbursements d",
    where: "d.state in ('CONFIRMED', 'MANUAL_CONFIRMED')",
    timeColumn: "d.settled_at",
    value: "coalesce(sum(d.amount), 0)",
    countExpr: "count(*)",
    countNoun: "disbursements",
    goodDirection: "up",
    dimensions: {
      product: {
        label: "Product",
        join: "join riri_loans l on l.id = d.loan_id join riri_products p on p.id = l.product_id",
        group: "coalesce(p.name, 'Unknown product')",
        name: "Product",
      },
      month: { label: "Month", group: "to_char(date_trunc('month', d.settled_at), 'Mon YYYY')", name: "Month" },
    },
  },
  {
    id: "collected",
    label: "Collected",
    unit: "KES",
    description:
      "Money that came back in — paybill receipts and successful STK repayments together. A lender thinks of this as one number; the database keeps it in two places, so this metric is the one that puts them back together.",
    synonyms: ["collected", "collections", "repayments", "received", "recovered", "money in", "inflow", "how much did we collect"],
    from: "riri_payments pay",
    timeColumn: "pay.received_at",
    value: "coalesce(sum(pay.amount), 0)",
    countExpr: "count(*)",
    countNoun: "payments",
    goodDirection: "up",
    dimensions: {
      channel: { label: "Channel", group: "pay.channel", name: "Channel" },
      product: {
        label: "Product",
        join: "left join riri_loans l on l.id = pay.loan_id left join riri_products p on p.id = l.product_id",
        group: "coalesce(p.name, 'Unallocated')",
        name: "Product",
      },
      month: { label: "Month", group: "to_char(date_trunc('month', pay.received_at), 'Mon YYYY')", name: "Month" },
    },
  },
  {
    id: "applications",
    label: "Applications",
    unit: "count",
    description: "Loan applications received. Sliced by status, this is your origination pipeline.",
    // Deliberately NOT "how many applications": that phrase is the opening of BOTH
    // "how many applications did we get" and "how many applications are waiting", and
    // as the longest match it would win the second question for the wrong metric.
    // The noun alone is enough; the qualifier decides. (See MetricSpec.specificity.)
    synonyms: ["applications", "applied", "requests", "application volume"],
    from: "riri_applications a",
    timeColumn: "a.created_at",
    defaultRange: "all",
    value: "count(*)",
    dimensions: {
      status: { label: "Status", group: "a.status", name: "Status" },
      product: { label: "Product", join: "left join riri_products p on p.id = a.product_id", group: "coalesce(p.name, 'No product')", name: "Product" },
      month: { label: "Month", group: "to_char(date_trunc('month', a.created_at), 'Mon YYYY')", name: "Month" },
    },
  },
  {
    id: "apps_waiting",
    label: "Applications waiting",
    unit: "count",
    description: "Applications that have arrived and are still waiting on a human decision — submitted, pre-screened, in officer review, or referred. This is the queue your officers should be clearing.",
    synonyms: ["waiting", "pipeline", "queue", "to review", "pending applications", "awaiting decision", "undecided", "waiting for a decision", "in the queue", "backlog"],
    // Every word above is a QUALIFIER — see MetricSpec.specificity.
    specificity: 2,
    from: "riri_applications a",
    where: "a.status in ('SUBMITTED', 'AI_PRESCREEN', 'OFFICER_REVIEW', 'REFERRED')",
    value: "count(*)",
    goodDirection: "down",
    dimensions: {
      status: { label: "Status", group: "a.status", name: "Status" },
      product: { label: "Product", join: "left join riri_products p on p.id = a.product_id", group: "coalesce(p.name, 'No product')", name: "Product" },
    },
  },
  {
    id: "approval_rate",
    label: "Approval rate",
    unit: "percent",
    description: "Of the applications you have actually decided, the share you approved. Applications still sitting in the queue are not counted either way.",
    synonyms: ["approval rate", "approved", "decline rate", "rejection rate", "how many do we approve"],
    from: "riri_applications a",
    where: "a.status in ('APPROVED', 'DISBURSED', 'DECLINED')",
    value: "100.0 * count(*) filter (where a.status in ('APPROVED', 'DISBURSED')) / nullif(count(*), 0)",
    dimensions: {
      product: { label: "Product", join: "left join riri_products p on p.id = a.product_id", group: "coalesce(p.name, 'No product')", name: "Product" },
    },
  },
  {
    id: "default_rate",
    label: "Default rate",
    unit: "percent",
    description:
      "Of the loans whose story has finished, the share that ended in default. Loans still running are excluded — they have not had the chance to go either way yet. These realised outcomes are the labels that train your credit models.",
    synonyms: ["default rate", "defaults", "write off", "charge off", "bad debt", "loss rate", "how many default"],
    from: "riri_applications a",
    where: "a.outcome in ('REPAID', 'DEFAULTED')",
    value: "100.0 * count(*) filter (where a.outcome = 'DEFAULTED') / nullif(count(*), 0)",
    goodDirection: "down",
    dimensions: {
      product: { label: "Product", join: "left join riri_products p on p.id = a.product_id", group: "coalesce(p.name, 'No product')", name: "Product" },
    },
  },
  {
    id: "borrowers",
    label: "Borrowers",
    unit: "count",
    description: "People on your book — everyone you have registered, whether they are currently borrowing or not.",
    synonyms: ["borrowers", "customers", "clients", "people", "how many borrowers"],
    from: "riri_borrowers b",
    timeColumn: "b.created_at",
    defaultRange: "all",
    value: "count(*)",
    dimensions: {
      kyc_status: { label: "KYC status", group: "b.kyc_status", name: "KYC status" },
      month: { label: "Month", group: "to_char(date_trunc('month', b.created_at), 'Mon YYYY')", name: "Month" },
    },
  },
  {
    id: "avg_loan_size",
    label: "Average loan size",
    unit: "KES",
    description: "The average principal of the loans on your active book — your typical ticket.",
    synonyms: ["average loan", "avg loan size", "ticket size", "typical loan", "average principal"],
    from: "riri_loans l",
    where: "l.status = 'ACTIVE'",
    value: "coalesce(avg(l.principal), 0)",
    countExpr: "count(*)",
    countNoun: "active loans",
    dimensions: { product: PRODUCT_OF_LOAN },
  },
  {
    id: "avg_score",
    label: "Average credit score",
    unit: "score",
    description: "The average score your models gave the applicants they assessed. Every score is a training row in the closed loop between what you predicted and what happened.",
    synonyms: ["score", "credit score", "average score", "scoring", "risk band", "how good are my borrowers"],
    from: "riri_scores sc",
    where: "sc.score is not null",
    timeColumn: "sc.created_at",
    defaultRange: "all",
    value: "coalesce(avg(sc.score), 0)",
    countExpr: "count(*)",
    countNoun: "scored applications",
    goodDirection: "up",
    dimensions: {
      risk_band: { label: "Risk band", group: "coalesce(sc.risk_band, 'Unbanded')", name: "Risk band" },
      month: { label: "Month", group: "to_char(date_trunc('month', sc.created_at), 'Mon YYYY')", name: "Month" },
    },
  },
  {
    id: "field_visits",
    label: "Field visits",
    unit: "count",
    description: "Visits your agents have been sent on — business verifications, collection visits and check-ins — in whatever state they are currently in.",
    synonyms: ["field", "visits", "field visits", "agents", "on the ground", "verification visits", "site visit"],
    from: "riri_field_visits v",
    timeColumn: "v.created_at",
    defaultRange: "all",
    value: "count(*)",
    dimensions: {
      status: { label: "Status", group: "v.status", name: "Status" },
      officer: { label: "Agent", join: "left join riri_staff s on s.id = v.agent_id", group: "coalesce(s.name, 'Unallocated')", name: "Agent" },
      month: { label: "Month", group: "to_char(date_trunc('month', v.created_at), 'Mon YYYY')", name: "Month" },
    },
  },
];

export const METRIC_IDS = METRICS.map((m) => m.id);
const BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export function metricSpec(id: string): MetricSpec | undefined {
  return BY_ID.get(id);
}

/** A metric id that isn't in this file does not exist — the AVAILABLE_FEATURES rule, for numbers. */
export function isMetricId(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

// ── Compilation ───────────────────────────────────────────────────────────────

/** Half-open [start, end). `unit` is what "the period before this one" means. */
export type TimeRange = { start: Date | null; end: Date | null; label: string; unit?: "day" | "week" | "month" | "year" };

export type CompileOptions = {
  range?: TimeRange;
  dimension?: DimensionId;
  /** Rows to return when sliced. Clamped — a chat panel is not a data export. */
  limit?: number;
};

export type CompiledQuery = {
  sql: string;
  params: unknown[];
  metricId: string;
  /** True when the result is a table of slices rather than a single number. */
  grouped: boolean;
  dimension?: DimensionId;
  range?: TimeRange;
};

/** PAR is a 30-day concept everywhere in this platform; keep the number in one place. */
export const PAR_DAYS = 30;

const MAX_GROUPS = 25;

/**
 * Turn a metric (plus an optional range and slice) into a real statement.
 *
 * Note what is NOT interpolated: nothing the user typed. A caller chooses a metric
 * id and a dimension id from closed sets defined in this file, and supplies dates
 * as bound parameters. The only strings that reach the SQL text are ones written
 * above by us — which is why a question mark in a borrower's name can never be a
 * quotation mark in a query.
 */
export function compile(spec: MetricSpec, opts: CompileOptions = {}): CompiledQuery {
  const params: unknown[] = [];
  const orgParam = params.push("__ORG__"); // placeholder, replaced by the caller's orgId
  void orgParam;

  const alias = spec.from.trim().split(/\s+/).pop()!;
  const conditions: string[] = [ORG(alias)];

  // $2 is reserved for the PAR cutoff whenever the metric's SQL mentions it, so
  // that parameter numbering stays stable whether or not a range is also applied.
  const needsParCutoff = /\$2\b/.test(spec.where ?? "") || /\$2\b/.test(spec.value);
  if (needsParCutoff) params.push(new Date(Date.now() - PAR_DAYS * 86_400_000));

  if (spec.where) conditions.push(`(${spec.where})`);

  const range = opts.range;
  const timed = Boolean(range && spec.timeColumn && (range.start || range.end));
  if (timed && range) {
    if (range.start) conditions.push(`${spec.timeColumn} >= $${params.push(range.start)}`);
    if (range.end) conditions.push(`${spec.timeColumn} < $${params.push(range.end)}`);
  }

  const dim = opts.dimension && spec.dimensions?.[opts.dimension];
  const joins = [dim?.join].filter(Boolean).join(" ");
  const limit = Math.min(Math.max(1, opts.limit ?? MAX_GROUPS), MAX_GROUPS);

  const sql = dim
    ? [
        `select ${dim.group} as label,`,
        `       ${spec.value} as value${spec.countExpr ? `, ${spec.countExpr} as n` : ""}`,
        `from ${spec.from} ${joins}`,
        `where ${conditions.join(" and ")}`,
        `group by ${dim.group}`,
        `order by value desc nulls last`,
        `limit ${limit}`,
      ].join(" ")
    : [
        `select ${spec.value} as value${spec.countExpr ? `, ${spec.countExpr} as n` : ""}`,
        `from ${spec.from} ${joins}`,
        `where ${conditions.join(" and ")}`,
      ].join(" ");

  return {
    sql: sql.replace(/\s+/g, " ").trim(),
    params,
    metricId: spec.id,
    grouped: Boolean(dim),
    dimension: opts.dimension,
    range: timed ? range : undefined,
  };
}

/**
 * A month-by-month series for the sparkline.
 *
 * Returns only the months that HAVE rows — a GROUP BY cannot invent a zero for a
 * month in which nothing happened, and `generate_series` is deliberately not on the
 * read surface. So the caller zero-fills the gaps against the calendar (see
 * `seriesFrom` in analyst.ts): a month with no disbursements must draw a bar of
 * zero, not be silently skipped, or the sparkline tells a flattering lie.
 */
export function compileSeries(spec: MetricSpec, months: number): CompiledQuery | null {
  if (!spec.timeColumn) return null;
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - (months - 1));

  const alias = spec.from.trim().split(/\s+/).pop()!;
  const conditions = [ORG(alias)];
  const params: unknown[] = ["__ORG__"];
  if (spec.where) conditions.push(`(${spec.where})`);
  conditions.push(`${spec.timeColumn} >= $${params.push(start)}`);

  const sql = [
    `select to_char(date_trunc('month', ${spec.timeColumn}), 'Mon') as label,`,
    `       date_trunc('month', ${spec.timeColumn}) as bucket,`,
    `       ${spec.value} as value`,
    `from ${spec.from}`,
    `where ${conditions.join(" and ")}`,
    `group by bucket, label`,
    `order by bucket asc`,
  ].join(" ");

  return { sql: sql.replace(/\s+/g, " ").trim(), params, metricId: spec.id, grouped: true };
}

/** Bind the compiled statement to the org whose book is being read. */
export function bind(q: CompiledQuery, orgId: string): { sql: string; params: unknown[] } {
  const params = q.params.map((p) => (p === "__ORG__" ? orgId : p));
  return { sql: q.sql, params };
}
