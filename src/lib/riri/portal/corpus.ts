// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER CORPUS — what Riri may say to a borrower, and where each word came from.
//
// Riri Ecosystem AI plan, §04. Two tiers and one retriever, on the customer surface:
//
//   TIER A · PLATFORM — the articles below, in code, in both voices. They describe
//            how Micro Eazy works and they are the only entries allowed to carry an
//            in-app destination (a `screen` id from app-map.ts, never a URL string).
//
//   TIER B · TENANT   — the lender's packs (pack.ts shape), audience "customer" only.
//            Facts about THEM: products, fees, terms, contact. Served from the
//            lender's own published document when they have one (Settings → Riri
//            knowledge, stored in OrgConfig "riri"), otherwise from the starter
//            pack shipped for that lender, stamped as unreviewed.
//
//   And the platform's own DOCUMENT-backed pack: Ratiba, from Safaricom's
//   agreement, which is true for every lender.
//
// ── WHY THE PLATFORM ARTICLES QUOTE NO LENDER'S PRICE ────────────────────────
// Same rule the app's help copy follows (micro-eazy-app/src/lib/help/content.ts):
// a figure that belongs to a lender belongs in that lender's pack, with a date and
// a review_by, and an id on every answer it produces. An article in code that says
// "the processing fee is KSh 400" is true until the day Micromart changes it, and
// then it is our promise, broken, with no version to point at.
//
// Retrieval is keyword scoring, deliberately — the same discipline as knowledge.ts,
// pinned by tests, with a confidence floor. On this surface a wrong answer delivered
// confidently costs a customer money or a missed instalment; "I'm not sure, let me
// get you to someone" costs a minute.
// ─────────────────────────────────────────────────────────────────────────────
import type { Pack, PackEntry, SourceRef } from "../pack";
import type { RiriLang } from "../core/context";
import ratibaPack from "../packs/ratiba.pack.json";
import micromartStarter from "../packs/micromart.customer.pack.json";

export type CustomerArticle = {
  id: string;
  category: "getting-started" | "statement" | "borrowing" | "repaying" | "standing" | "riri" | "privacy";
  /** How people actually ask — English, Kiswahili and Sheng in one list. */
  asks: string[];
  en: { title: string; body: string };
  sw: { title: string; body: string };
  /** The app screen that is the natural next step — an id in app-map.ts. */
  screen?: string;
  /** True where the honest answer is "this needs a person" — the answer offers one. */
  offersPerson?: boolean;
};

export const CUSTOMER_ARTICLES: CustomerArticle[] = [
  {
    id: "riri-who",
    category: "riri",
    asks: ["who are you", "are you a robot", "are you human", "is this a bot", "what can you do", "what can you help with", "i need help", "help me", "can you help me", "nisaidie", "wewe ni nani", "unaweza kunisaidia na nini", "riri ni nani"],
    en: {
      title: "I'm Riri",
      body: "I'm Riri, the assistant in this app. I can answer questions about your loan, your repayments, your limit and score, M-PESA Ratiba, and how Micro Eazy works — straight from your own account, not from guesses. If I find something I can't sort out, I'll pass it to a person at your lender with everything I already checked, so you never have to explain twice. And if you'd rather talk to a person from the start, just say so.",
    },
    sw: {
      title: "Mimi ni Riri",
      body: "Mimi ni Riri, msaidizi wa programu hii. Naweza kujibu maswali kuhusu mkopo wako, malipo yako, kiwango chako na alama yako, M-PESA Ratiba, na jinsi Micro Eazy inavyofanya kazi — moja kwa moja kutoka kwa akaunti yako. Nikikutana na jambo nisiloweza kulitatua, nitalipeleka kwa mtu kwenye shirika lako pamoja na yote niliyokwisha kuangalia, ili usilazimike kueleza mara mbili. Na ukipenda kuongea na mtu tangu mwanzo, sema tu.",
    },
  },
  {
    id: "what-is-micro-eazy",
    category: "riri",
    asks: ["what is micro eazy", "who owns micro eazy", "is micro eazy a lender", "who lends the money", "who is my lender", "micro eazy ni nini", "nani anakopesha"],
    en: {
      title: "What Micro Eazy is",
      body: "Micro Eazy is a technology platform. Your loan is funded by a licensed lender — the one whose name and colours you see in this app — and every decision on your screen can be explained to you on request. Micro Eazy runs the app, the checks and the conversation; the money, the loan and the decision are your lender's.",
    },
    sw: {
      title: "Micro Eazy ni nini",
      body: "Micro Eazy ni jukwaa la teknolojia. Mkopo wako unatolewa na mkopeshaji mwenye leseni — yule ambaye jina na rangi zake unaziona kwenye programu hii — na kila uamuzi kwenye skrini yako unaweza kuelezwa ukiomba. Micro Eazy inaendesha programu, ukaguzi na mazungumzo; pesa, mkopo na uamuzi ni wa mkopeshaji wako.",
    },
  },
  {
    id: "why-declined",
    category: "standing",
    asks: ["why was i declined", "loan declined", "declined why", "why was my loan rejected", "my loan was declined", "can i appeal", "appeal a decision", "kwa nini nimekataliwa", "mkopo umekataliwa"],
    en: {
      title: "Why an application was declined",
      body: "Your score screen shows the decision and every reason behind it, side by side with what you can do about each one — and where a reason says nothing you do changes it, that is true, it is usually time that has to pass. If you think a decision was made on something wrong, you can ask for it to be looked at again; that needs a person, and I can pass it to the team.",
    },
    sw: {
      title: "Kwa nini ombi lilikataliwa",
      body: "Skrini ya alama yako inaonyesha uamuzi na kila sababu yake, pamoja na unachoweza kufanya kuhusu kila moja — na sababu ikisema hakuna unachoweza kubadilisha, ni kweli, kwa kawaida ni muda unaohitaji kupita. Ukidhani uamuzi ulifanywa kwa jambo lisilo sahihi, unaweza kuomba uangaliwe upya; hilo linahitaji mtu, na naweza kulipeleka kwa timu.",
    },
    screen: "app-score",
    offersPerson: true,
  },
  {
    id: "open-account",
    category: "getting-started",
    asks: ["what do i need to open an account", "what do i need to register", "requirements", "register", "how do i join", "how do i register", "sign up", "open account", "nahitaji nini", "jinsi ya kujiunga", "kujisajili"],
    en: {
      title: "What you need to open an account",
      body: "Your National ID, the phone number registered in your name, and a six-month M-PESA statement. Depending on your lender you may also be asked for a selfie, your business location and a referee.",
    },
    sw: {
      title: "Unachohitaji kufungua akaunti",
      body: "Kitambulisho chako cha Taifa, nambari ya simu iliyosajiliwa kwa jina lako, na taarifa ya M-PESA ya miezi sita. Kulingana na shirika lako unaweza pia kuombwa picha ya uso (selfie), mahali biashara yako ilipo na mdhamini.",
    },
    screen: "app-kyc",
  },
  {
    id: "why-verify",
    category: "getting-started",
    asks: ["why do you verify my identity", "why do you need my id", "why selfie", "is my id safe", "kwa nini mnahitaji kitambulisho", "kwa nini selfie"],
    en: {
      title: "Why your identity is checked",
      body: "A licensed lender has to know who it lends to. Your ID is read, confirmed against the national registry, and your face is matched to the photo on the card. Every customer goes through the same checks — there is no shorter version, and your photos are used for that check and nothing else.",
    },
    sw: {
      title: "Kwa nini utambulisho wako unathibitishwa",
      body: "Mkopeshaji mwenye leseni lazima amjue anayemkopesha. Kitambulisho chako kinasomwa, kinathibitishwa na sajili ya taifa, na uso wako unalinganishwa na picha iliyo kwenye kadi. Kila mteja hupitia ukaguzi huo huo, na picha zako hutumika kwa ukaguzi huo pekee.",
    },
    screen: "app-kyc",
  },
  {
    id: "id-under-review",
    category: "getting-started",
    asks: ["my id is under review", "id check pending", "verification pending", "why is my kyc pending", "how long does verification take", "kitambulisho kinakaguliwa", "uthibitisho unachukua muda gani"],
    en: {
      title: "When your ID check says a person is reviewing it",
      body: "Your lender signs off every new customer's identity before any money moves, so a check can sit with a person for a while. You can carry on with your statement meanwhile, and the result appears in the app the moment it is decided. If it has been more than a working day, I can ask the team to look.",
    },
    sw: {
      title: "Ukaguzi wa kitambulisho ukisema mtu anaukagua",
      body: "Shirika lako huthibitisha utambulisho wa kila mteja mpya kabla pesa yoyote kutumwa, kwa hivyo ukaguzi unaweza kukaa na mtu kwa muda. Unaweza kuendelea na taarifa yako ya M-PESA wakati huo, na matokeo yataonekana kwenye programu mara tu yatakapoamuliwa. Ikiwa imepita zaidi ya siku moja ya kazi, naweza kuiomba timu iangalie.",
    },
    screen: "app-kyc",
    offersPerson: true,
  },
  {
    id: "get-statement",
    category: "statement",
    asks: ["how do i get my mpesa statement", "get statement", "mpesa statement", "request statement", "statement password", "nitapataje statement", "taarifa ya mpesa", "statement ya mpesa"],
    en: {
      title: "How to get your M-PESA statement",
      body: "Dial *334#, choose My Account, then M-PESA Statement, Request Statement, Full Statement, and Last 6 months. Safaricom emails you a locked PDF and texts you the password. Upload that PDF in the statement cruncher and enter the password from the SMS.",
    },
    sw: {
      title: "Jinsi ya kupata taarifa yako ya M-PESA",
      body: "Piga *334#, chagua My Account, kisha M-PESA Statement, Request Statement, Full Statement, na Last 6 months. Safaricom watakutumia PDF iliyofungwa kwa barua pepe na nenosiri kwa SMS. Pakia PDF hiyo kwenye statement cruncher na uweke nenosiri kutoka kwa SMS.",
    },
    screen: "app-crunch",
  },
  {
    id: "statement-safe",
    category: "statement",
    asks: ["is my statement safe", "who sees my statement", "do you share my statement", "privacy of my statement", "statement yangu iko salama"],
    en: {
      title: "What happens to your statement",
      body: "It is read on the server to work out what you can comfortably afford, and what is kept is a score and a summary. It is not shared with anyone outside your lender.",
    },
    sw: {
      title: "Kinachofanyika kwa taarifa yako",
      body: "Inasomwa kwenye seva ili kujua unachoweza kulipa kwa urahisi, na kinachohifadhiwa ni alama na muhtasari. Haishirikiwi na mtu yeyote nje ya shirika lako.",
    },
  },
  {
    id: "statement-wrong-name",
    category: "statement",
    asks: ["statement in someone else's name", "statement name does not match", "name mismatch", "wrong name statement", "name is wrong on my statement", "statement is in my husband's name", "different name on statement", "jina tofauti kwenye statement"],
    en: {
      title: "When the statement is in a different name",
      body: "A statement can only score the person named on it. Upload your own — or, if it is yours under a different registered name, raise it from the statement screen and a person will look at it.",
    },
    sw: {
      title: "Taarifa ikiwa na jina tofauti",
      body: "Taarifa inaweza kupima tu mtu aliyetajwa ndani yake. Pakia yako mwenyewe — au, ikiwa ni yako kwa jina lingine lililosajiliwa, iwasilishe kutoka kwa skrini ya taarifa na mtu ataiangalia.",
    },
    screen: "app-crunch",
    offersPerson: true,
  },
  {
    id: "products-unlock",
    category: "borrowing",
    asks: ["which products can i choose", "why is a product locked", "unlock a product", "product locked", "why can't i choose", "bidhaa imefungwa"],
    en: {
      title: "Why some products are locked",
      body: "Products open up with your limit. A smaller starting limit opens the entry product; once your limit reaches a product's minimum, it unlocks. A locked product always shows you the reason, so you know what you are working towards.",
    },
    sw: {
      title: "Kwa nini baadhi ya bidhaa zimefungwa",
      body: "Bidhaa hufunguka kulingana na kiwango chako. Kiwango kidogo cha kuanzia hufungua bidhaa ya mwanzo; kiwango chako kikifika kiwango cha chini cha bidhaa, inafunguka. Bidhaa iliyofungwa huonyesha sababu kila mara.",
    },
    screen: "app-apply",
  },
  {
    id: "choose-weeks",
    category: "borrowing",
    asks: ["can i choose how long to repay", "repayment period", "how many weeks", "change instalments", "choose weeks", "muda wa kulipa", "wiki ngapi"],
    en: {
      title: "Choosing how long to repay",
      body: "On weekly products you choose the number of weeks, up to the product's maximum, and interest is priced for exactly that many weeks. You can also move amounts between instalments, as long as the total stays the same.",
    },
    sw: {
      title: "Kuchagua muda wa kulipa",
      body: "Kwenye bidhaa za kila wiki unachagua idadi ya wiki, hadi kiwango cha juu cha bidhaa, na riba inahesabiwa kwa wiki hizo pekee. Unaweza pia kuhamisha kiasi kati ya awamu, mradi jumla ibaki ile ile.",
    },
    screen: "app-apply",
  },
  {
    id: "how-apply",
    category: "borrowing",
    asks: ["how do i apply", "how to apply", "how do i get a loan", "apply for a loan", "i want a loan", "steps to borrow", "nitaombaje mkopo", "jinsi ya kuomba mkopo", "nataka mkopo"],
    en: {
      title: "How to apply",
      body: "Three steps, in order. First the ID check, so your lender knows who they are lending to. Then the statement cruncher, which reads your six-month M-PESA statement and sets your starting limit. Then Apply now: choose a product your limit unlocks, pick the amount and how many weeks, read the full cost, and send it. If you've already done the first two, you go straight to Apply now.",
    },
    sw: {
      title: "Jinsi ya kuomba",
      body: "Hatua tatu, kwa mpangilio. Kwanza ukaguzi wa kitambulisho, ili shirika lako likujue. Kisha statement cruncher, inayosoma taarifa yako ya M-PESA ya miezi sita na kuweka kiwango chako cha kuanzia. Kisha Apply now: chagua bidhaa ambayo kiwango chako kinafungua, chagua kiasi na idadi ya wiki, soma gharama kamili, na utume. Ikiwa umeshamaliza hatua mbili za kwanza, unaenda moja kwa moja kwa Apply now.",
    },
    screen: "app-apply",
  },
  {
    id: "charges-explained",
    category: "borrowing",
    asks: ["how is interest calculated", "understanding the charges", "how do fees work", "interest per week", "total cost of a loan", "riba inahesabiwaje", "gharama ya mkopo"],
    en: {
      title: "How the cost of a loan works",
      body: "Every loan has two kinds of cost: interest and fees. Interest is charged per repayment period, so a product priced per week costs that rate for each week you choose — fewer weeks costs less. Fees are charged one of three ways: paid before the money is sent, deducted from the amount sent, or spread across your instalments. Both are priced for your exact amount on the loan overview before you apply, and nothing is added after you agree.",
    },
    sw: {
      title: "Jinsi gharama ya mkopo inavyofanya kazi",
      body: "Kila mkopo una aina mbili za gharama: riba na ada. Riba hutozwa kwa kila kipindi cha malipo, kwa hivyo bidhaa ya kila wiki hugharimu kiwango hicho kwa kila wiki unayochagua — wiki chache zinagharimu kidogo. Ada hutozwa kwa njia tatu: kulipwa kabla pesa kutumwa, kukatwa kutoka kwa kiasi kinachotumwa, au kugawanywa kwenye awamu zako. Zote zinaonyeshwa kwa kiasi chako kabla ya kuomba, na hakuna kinachoongezwa baada ya kukubali.",
    },
    screen: "app-apply",
  },
  {
    id: "how-repay",
    category: "repaying",
    asks: ["how do i repay", "how do i pay", "how to pay my loan", "pay my loan", "paybill", "stk push", "nitalipaje", "jinsi ya kulipa", "kulipa mkopo"],
    en: {
      title: "How to repay",
      body: "Open Repay and press Pay now — an M-PESA prompt comes to your registered phone, and you enter your PIN. Press it once and wait for the prompt; pressing again sends a second prompt. Money goes to your loan first, and anything left over goes to your savings.",
    },
    sw: {
      title: "Jinsi ya kulipa",
      body: "Fungua Repay na ubonyeze Pay now — ombi la M-PESA litakuja kwenye simu yako iliyosajiliwa, na uweke PIN yako. Bonyeza mara moja na usubiri ombi; ukibonyeza tena, ombi la pili litatumwa. Pesa huenda kwa mkopo wako kwanza, na kinachobaki huenda kwa akiba yako.",
    },
    screen: "app-repay",
  },
  {
    id: "pay-early",
    category: "repaying",
    asks: ["can i pay early", "pay off early", "clear my loan", "clear my loan early", "pay off my loan", "early repayment", "repay in full", "kulipa mapema", "maliza mkopo mapema", "maliza mkopo"],
    en: {
      title: "Paying early",
      body: "You may repay the full balance at any time. Clearing a loan early also helps your limit at the next review.",
    },
    sw: {
      title: "Kulipa mapema",
      body: "Unaweza kulipa salio lote wakati wowote. Kumaliza mkopo mapema pia husaidia kiwango chako kwenye ukaguzi unaofuata.",
    },
    screen: "app-repay",
  },
  {
    id: "will-be-late",
    category: "repaying",
    asks: ["i can't pay this week", "i will not manage to pay", "can i get more time", "extend my due date", "sitaweza kulipa", "naomba muda zaidi", "reschedule"],
    en: {
      title: "If you can't make a payment",
      body: "Tell the team before the due date — that is always better than missing it. Only the team can agree a change to your plan, and a late instalment can attract a late fee and lower your score. I can pass this to them now with your account details, so they already know the situation when they reply.",
    },
    sw: {
      title: "Ikiwa huwezi kulipa",
      body: "Iambie timu kabla ya tarehe ya kulipa — hilo ni bora kila mara kuliko kukosa. Ni timu pekee inayoweza kukubali mabadiliko ya mpango wako, na awamu iliyochelewa inaweza kutozwa ada na kushusha alama yako. Naweza kulipeleka kwao sasa pamoja na maelezo ya akaunti yako.",
    },
    offersPerson: true,
  },
  {
    id: "credit-score",
    category: "standing",
    asks: ["what is a credit score", "how does my score work", "what raises my score", "what lowers my score", "improve my score", "alama ya mkopo", "kuongeza alama"],
    en: {
      title: "What your credit score is",
      body: "Your score is a number between 300 and 900 that sums up how likely you are to repay on time — the higher it is, the more a lender can safely offer you. Instalments paid on time and loans cleared in full raise it; late or missed instalments, heavy borrowing elsewhere and bureau listings lower it. Checking your own score never counts against you.",
    },
    sw: {
      title: "Alama yako ya mkopo ni nini",
      body: "Alama yako ni nambari kati ya 300 na 900 inayoonyesha uwezekano wa kulipa kwa wakati — ikiwa juu, mkopeshaji anaweza kukupa zaidi kwa usalama. Awamu zinazolipwa kwa wakati na mikopo inayomalizwa huiongeza; awamu zilizochelewa, kukopa kwingi mahali pengine na kuorodheshwa CRB huishusha. Kuangalia alama yako mwenyewe hakukuathiri kamwe.",
    },
    screen: "app-score",
  },
  {
    id: "limit-moves",
    category: "standing",
    asks: ["what moves my limit", "how do i increase my limit", "raise my limit", "why is my limit low", "limit review", "kuongeza kiwango", "kwa nini kiwango changu ni kidogo"],
    en: {
      title: "What moves your limit",
      body: "Your limit is reviewed every time you repay, and nobody sets it by hand. Four things move it: how you repay (on time, every time, is the biggest), your cashflow on your M-PESA statement, your credit bureau record, and how much you lean on other loans or betting. Every change, up or down, is on your limit ladder with the reason.",
    },
    sw: {
      title: "Kinachobadilisha kiwango chako",
      body: "Kiwango chako hukaguliwa kila unapolipa, na hakuna anayekiweka kwa mkono. Mambo manne hukibadilisha: jinsi unavyolipa (kwa wakati kila mara ndilo kubwa zaidi), mzunguko wa pesa kwenye taarifa yako ya M-PESA, rekodi yako ya CRB, na kiasi unachotegemea mikopo mingine au kamari. Kila badiliko liko kwenye limit ladder pamoja na sababu.",
    },
    screen: "app-ladder",
  },
  {
    id: "crb-listing",
    category: "privacy",
    asks: ["am i listed on crb", "am i on crb", "crb listing", "crb", "remove me from crb", "clear my crb", "nimeorodheshwa crb", "crb clearance"],
    en: {
      title: "Your credit bureau file",
      body: "Your credit file shows what the bureau held at your last check, and what other lenders in the network report — in ranges, never names. A listing is removed by the bureau once the lender that reported it confirms the debt is settled; if you think a listing is wrong, that needs a person, and I can pass it to the team.",
    },
    sw: {
      title: "Faili lako la CRB",
      body: "Faili lako linaonyesha kilichokuwa kwenye CRB wakati wa ukaguzi wako wa mwisho, na kile wakopeshaji wengine kwenye mtandao wanaripoti — kwa viwango, si majina. Kuorodheshwa huondolewa na CRB mara mkopeshaji aliyeripoti athibitishe deni limelipwa; ukidhani ni makosa, hilo linahitaji mtu, na naweza kulipeleka kwa timu.",
    },
    screen: "app-exposure",
    offersPerson: true,
  },
];

// ── Packs ────────────────────────────────────────────────────────────────────

/** A pack as served, with the stamp that goes on every answer it produces. */
export type ServedPack = { pack: Pack; ref: SourceRef & { starter: boolean } };

/** Starter packs we ship per lender slug until the lender publishes their own. */
const STARTERS: Record<string, Pack> = {
  micromart: micromartStarter as unknown as Pack,
};

/** Platform packs every customer surface reads. */
const PLATFORM_PACKS: Pack[] = [ratibaPack as unknown as Pack];

/** The starter a lender inherits, for the training console to show and replace. */
export const starterPackFor = (lenderSlug: string): Pack | null => STARTERS[lenderSlug] ?? null;

/**
 * The packs a customer of this lender may retrieve.
 *
 * `published` is the lender's own document from the config store, when there is
 * one; it REPLACES the starter for the same pack id, so a lender who publishes
 * `micromart.customer` v2 is never answered from our v1 again. A pack whose
 * audience does not include "customer" is dropped here, at the only door, so no
 * question phrasing can reach a staff-only answer.
 */
export function customerPacks(lenderSlug: string, published: Pack[] = []): ServedPack[] {
  return servedPacks(lenderSlug, published, "customer");
}

/**
 * The packs one AUDIENCE may retrieve — customer, staff, developer. The audience is
 * decided by the calling surface (core/context.ts AUDIENCE_OF), never by the
 * question, so no phrasing reaches a pack its asker is not entitled to.
 */
export function servedPacks(lenderSlug: string, published: Pack[], audience: "customer" | "staff" | "developer"): ServedPack[] {
  const byId = new Map<string, ServedPack>();
  for (const p of PLATFORM_PACKS) byId.set(p.pack, { pack: p, ref: { ...stamp(p), starter: false } });
  const starter = STARTERS[lenderSlug];
  if (starter) byId.set(starter.pack, { pack: starter, ref: { ...stamp(starter), starter: true } });
  for (const p of published) byId.set(p.pack, { pack: p, ref: { ...stamp(p), starter: false } });
  return [...byId.values()].filter((s) => s.pack.audience.includes(audience));
}

const stamp = (p: Pack): SourceRef => ({ pack: p.pack, version: p.version, authority: p.authority, owner: p.owner });

// ── Retrieval ────────────────────────────────────────────────────────────────

const STOP = new Set([
  "how", "do", "i", "to", "the", "a", "an", "is", "are", "can", "you", "my", "me", "what", "where", "when", "why",
  "in", "on", "of", "for", "and", "it", "this", "that", "with", "please", "riri", "help", "does", "will", "have",
  "ya", "za", "wa", "la", "cha", "na", "kwa", "ni", "je", "nini", "gani", "kwenye", "katika", "kuhusu", "tafadhali",
]);

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9*#' ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Crude but CONSISTENT stemming — the property that matters is that both sides of a
 * comparison land on the same stem: "charge"/"charges"/"charged" → "charg",
 * "fee"/"fees" → "fe", "payments" → "payment".
 */
export const stem = (w: string): string => {
  let s = w;
  if (s.length > 3) s = s.replace(/ies$/, "y").replace(/(?:ing|ed|es|s)$/, "");
  if (s.length > 3) s = s.replace(/e$/, "");
  return s || w;
};

function scorePhrases(q: string, phrases: string[], hay: string): number {
  const nq = norm(q);
  const qWords = new Set(nq.split(" ").map(stem));
  let best = 0;
  for (const p of phrases) {
    const np = norm(p);
    if (!np) continue;
    if (nq === np) best = Math.max(best, 40 + np.length / 4);
    else if (np.includes(" ") && nq.includes(np)) best = Math.max(best, 20 + np.length / 3);
    else if (np.includes(" ") && np.includes(nq) && nq.length > 8) best = Math.max(best, 14);
    // A one-word phrasing ("fees", "*334#") counts when the question contains that word.
    else if (!np.includes(" ") && np.length > 3 && qWords.has(stem(np))) best = Math.max(best, 12);
    // Every content word of a phrasing present, in any order, with words between:
    // "why is my limit so low" is "why is my limit low" said by a person.
    else {
      const content = tokens(np).map(stem);
      if (content.length >= 2 && content.every((w) => qWords.has(w))) best = Math.max(best, 16 + content.length * 2);
    }
  }
  const h = new Set(tokens(hay).map(stem));
  let loose = 0;
  for (const w of tokens(q)) if (h.has(stem(w))) loose += 4;
  return best + Math.min(loose, 16);
}

export type CorpusHit =
  | { kind: "article"; score: number; article: CustomerArticle; title: string; body: string; sourceId: string }
  | { kind: "pack"; score: number; entry: PackEntry; served: ServedPack; sourceId: string };

/** Below this, a hit is word overlap, not an answer. Pinned by the tests. */
export const CORPUS_FLOOR = 14;

export function searchCorpus(question: string, lang: RiriLang, packs: ServedPack[], limit = 3, includeArticles = true): CorpusHit[] {
  const hits: CorpusHit[] = [];
  // The articles describe the Micro Eazy app. A partner's embed is not that app.
  for (const a of includeArticles ? CUSTOMER_ARTICLES : []) {
    const v = a[lang];
    const score = scorePhrases(question, a.asks, `${a.en.title} ${a.sw.title} ${a.asks.join(" ")}`);
    if (score >= CORPUS_FLOOR) hits.push({ kind: "article", score, article: a, title: v.title, body: v.body, sourceId: `article:${a.id}` });
  }
  for (const served of packs) {
    served.pack.entries.forEach((entry, i) => {
      const score = scorePhrases(question, [entry.question, ...(entry.variants ?? [])], `${entry.question} ${(entry.variants ?? []).join(" ")} ${entry.category}`);
      if (score >= CORPUS_FLOOR) hits.push({ kind: "pack", score, entry, served, sourceId: `${served.pack.pack}@${served.pack.version}#${i}` });
    });
  }
  hits.sort((a, z) => z.score - a.score);
  return hits.slice(0, limit);
}

/** What goes on the answer's stamp for a hit — the founder's "pack id on every answer". */
export function hitSource(hit: CorpusHit): { id: string; label: string; starter?: boolean } {
  if (hit.kind === "article") return { id: hit.sourceId, label: "Micro Eazy help" };
  const r = hit.served.ref;
  const who = r.authority === "platform" ? "Platform" : r.starter ? "Starter pack" : "Lender pack";
  return { id: hit.sourceId, label: `${who} · ${r.pack} v${r.version}`, starter: r.starter };
}
