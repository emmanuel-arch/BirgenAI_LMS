// ─────────────────────────────────────────────────────────────────────────────
// RIRI SUPPORT — what Riri knows about this platform.
//
// THE CORPUS IS CODE. Not a CMS, not a vector store we quietly hope is in sync: the
// same discipline as the metric catalogue and the price book, and for the same reason.
// An article here is written, reviewed and shipped in the diff that builds the screen
// it describes — so Riri physically cannot give a lender confident instructions about
// a button that does not exist. That failure mode is the one thing an AI support agent
// must not have, because the user cannot tell a hallucinated workflow from a real one;
// they will simply conclude the software is broken.
//
// Three properties fall out of keeping it here:
//
//   1. IT CANNOT DRIFT. Delete a screen and the article stops compiling (its `href` and
//      its `right` are typed against the real nav registry and the real rights list).
//   2. IT IS PERSONAL WITHOUT BEING RISKY. Every article declares the RIGHT and the
//      PLAN FEATURE it needs. Riri filters on the asker: she never tells a loan officer
//      to open Settings → Vault, because he cannot, and telling him to would be worse
//      than saying nothing. What he gets instead is who to ask.
//   3. IT CAN ACT. An article carries a destination, so an answer is not a paragraph
//      ending in "go to Products" — it ends in a button that goes to Products. With
//      consent, always: Riri offers, a human accepts.
//
// AND IT IS BILINGUAL (item 20, blueprint §5.1). Every article carries a REQUIRED `sw`
// block — the type makes an untranslated article a compile error, exactly the way a
// feature missing from AVAILABLE_FEATURES cannot be sold. Ask in Kiswahili, get the
// answer in Kiswahili: `detectLang` reads the question, retrieval scores both
// languages' phrasings, and the rights/consent/confidence machinery is shared — there
// is one corpus with two voices, never two corpora that drift apart. Menu names
// (Products, Settings → Vault) stay in English inside Kiswahili sentences because
// that is what the buttons actually say — a translated path the screen doesn't show
// is a hallucinated path.
//
// The retrieval is deliberately boring (weighted keyword scoring over titles, phrasings
// and tags). It is not the interesting part and it should not pretend to be — a support
// question is short and vocabulary-bound, and a wrong answer delivered fluently is
// worse than a right one delivered plainly. `RIRI_LLM_KEY` upgrades the PHRASING and
// the ranking later; the corpus, the rights filter and the consent step do not move.
// ─────────────────────────────────────────────────────────────────────────────
import type { Right } from "@/lib/rbac/rights";
import type { Feature } from "@/lib/billing/plans";

export type KnowledgeCategory =
  | "getting-started" | "lending" | "money" | "collections" | "people" | "intelligence" | "account";

export type SupportLang = "en" | "sw";

/** The Kiswahili voice of an article. REQUIRED — an article cannot ship without it. */
export type ArticleSw = {
  title: string;
  /** How a Kiswahili speaker asks for this. Retrieval matches these too. */
  asks: string[];
  body: string;
  /** Must mirror the English steps one-for-one (pinned by test) — same actions, same order. */
  steps?: string[];
  /** The action button's label; the href is shared with English (screens don't move). */
  actionLabel?: string;
};

export type Article = {
  id: string;
  title: string;
  category: KnowledgeCategory;
  /** How a real person asks for this. The router matches on these, longest-first. */
  asks: string[];
  /** The answer, in the words a lender's staff would use. No jargon we invented. */
  body: string;
  /** Concrete steps. Numbered in the answer. */
  steps?: string[];
  /** Where to go to actually do it. Riri offers to take them (with consent). */
  action?: { label: string; href: string };
  /** Who may do this. Riri tells anyone else who to ask instead of how to do it. */
  right?: Right;
  /** Which package it needs. Riri says so plainly rather than sending them to a wall. */
  feature?: Feature;
  /** What to read next. */
  related?: string[];
  /** The same article, in Kiswahili. */
  sw: ArticleSw;
};

export const ARTICLES: Article[] = [
  // ── Getting started ────────────────────────────────────────────────────────
  {
    id: "setup-order",
    title: "Setting up your lender for the first time",
    category: "getting-started",
    asks: ["how do i start", "getting started", "set up", "setup", "first steps", "what do i do first", "new organisation", "new organization", "where do i begin", "onboarding"],
    body:
      "There is an order to this, and it is worth following — each step needs the one before it. Most lenders are taking their first application within an hour.",
    steps: [
      "Build your structure: your head office, then any regions and branches. Everything else hangs off it — staff, borrowers, loans, and who is allowed to see whose book.",
      "Create at least one loan product: how much you lend, for how long, at what rate.",
      "Set up an approval workflow, or use the built-in two-tier default (an officer initiates, a second person finalises).",
      "Invite your team and give each person a role. The role decides both what they can do and whose customers they can see.",
      "Connect your money rails in Settings → Vault: your M-Pesa credentials for collecting and paying out.",
      "Ask the platform to activate you. Until then you can configure everything, but you cannot lend real money.",
    ],
    action: { label: "Open your setup checklist", href: "/console" },
    related: ["branches-build", "product-create", "team-invite", "activation"],
    sw: {
      title: "Kuanzisha shirika lako la ukopeshaji kwa mara ya kwanza",
      asks: ["ninaanzaje", "jinsi ya kuanza", "nianze vipi", "hatua za kwanza", "nifanye nini kwanza", "shirika jipya", "nianzie wapi", "maandalizi ya kwanza"],
      body:
        "Kuna mpangilio wa mambo haya, na unafaa kuufuata — kila hatua inahitaji ile iliyotangulia. Wakopeshaji wengi hupokea ombi lao la kwanza ndani ya saa moja.",
      steps: [
        "Jenga muundo wako: makao makuu, kisha maeneo na matawi yoyote. Kila kitu kingine hutegemea muundo huo — wafanyakazi, wakopaji, mikopo, na nani anaruhusiwa kuona kitabu cha nani.",
        "Tengeneza angalau bidhaa moja ya mkopo: unakopesha kiasi gani, kwa muda gani, kwa riba gani.",
        "Weka mtiririko wa idhini, au tumia ule wa kawaida wa ngazi mbili (afisa huanzisha, mtu wa pili hukamilisha).",
        "Alika timu yako na umpe kila mtu jukumu. Jukumu huamua wanachoweza kufanya na wateja wa nani wanaowaona.",
        "Unganisha njia zako za pesa katika Settings → Vault: vitambulisho vyako vya M-Pesa vya kukusanya na kutoa.",
        "Omba jukwaa likuwashe. Hadi hapo unaweza kusanidi kila kitu, lakini huwezi kukopesha pesa halisi.",
      ],
      actionLabel: "Fungua orodha yako ya maandalizi",
    },
  },
  {
    id: "activation",
    title: "Getting activated so you can lend",
    category: "getting-started",
    asks: ["activate", "activation", "why can't i disburse", "why cant i lend", "pending", "approve my organisation", "go live"],
    body:
      "A new lender starts PENDING. You can build products, invite staff and configure everything — but no real money moves until BirgenAI activates you. That gate exists because disbursement moves real funds and the platform is answerable for who is on it.",
    steps: [
      "Finish the setup checklist on your console home — products, workflows, roles, team, and your money credentials.",
      "Click 'Request activation'. That tells us you are ready.",
      "We review and switch you to ACTIVE. Your existing configuration is untouched.",
    ],
    action: { label: "Go to your checklist", href: "/console" },
    sw: {
      title: "Kuwashwa ili uweze kukopesha",
      asks: ["kuwashwa", "uanzishaji rasmi", "kwa nini siwezi kukopesha bado", "shirika langu linasubiri", "idhinisha shirika langu", "anza kazi rasmi"],
      body:
        "Mkopeshaji mpya huanza akiwa PENDING. Unaweza kutengeneza bidhaa, kualika wafanyakazi na kusanidi kila kitu — lakini hakuna pesa halisi itakayotoka hadi BirgenAI ikuwashe. Kizuizi hicho kipo kwa sababu utoaji huhamisha pesa halisi na jukwaa linawajibika kwa walio ndani yake.",
      steps: [
        "Kamilisha orodha ya maandalizi kwenye ukurasa wa mwanzo wa console — bidhaa, mitiririko ya idhini, majukumu, timu, na vitambulisho vya pesa.",
        "Bofya 'Request activation'. Hiyo hutuambia uko tayari.",
        "Tunakagua na kukubadilisha kuwa ACTIVE. Usanidi wako haubadilishwi.",
      ],
      actionLabel: "Nenda kwenye orodha yako",
    },
  },

  // ── Structure & people ─────────────────────────────────────────────────────
  {
    id: "branches-build",
    title: "Building your organisation structure",
    category: "people",
    asks: ["branch", "branches", "structure", "org chart", "regions", "head office", "add a branch", "sub branch", "organisation structure", "organizational structure", "units", "offices"],
    body:
      "Your structure is one tree: a head office at the top, and whatever you hang beneath it — regions, branches, sub-branches, units. You name the levels yourself, because your company already has words for them and you should not have to translate.",
    steps: [
      "Open Organisation → Structure.",
      "Create your head office first. Everything else reports to something.",
      "Add regions and branches underneath, with the '+' on whichever office they report to.",
      "Give each staff member a branch when you invite them — that is what puts their customers somewhere.",
    ],
    action: { label: "Open Structure", href: "/console/branches" },
    right: "branches.view",
    related: ["who-sees-what", "team-invite"],
    sw: {
      title: "Kujenga muundo wa shirika lako",
      asks: ["tawi", "matawi", "muundo wa shirika", "maeneo", "makao makuu", "ongeza tawi", "tawi dogo", "ofisi zetu", "vitengo"],
      body:
        "Muundo wako ni mti mmoja: makao makuu juu, na chochote unachotundika chini yake — maeneo, matawi, matawi madogo, vitengo. Unayapa majina mwenyewe, kwa sababu kampuni yako tayari ina maneno yake na hupaswi kulazimika kutafsiri.",
      steps: [
        "Fungua Organisation → Structure.",
        "Tengeneza makao makuu kwanza. Kila kitu kingine huripoti kwa kitu fulani.",
        "Ongeza maeneo na matawi chini yake, kwa alama ya '+' kwenye ofisi wanayoripoti kwayo.",
        "Mpe kila mfanyakazi tawi unapomwalika — ndicho kinachoweka wateja wake mahali.",
      ],
      actionLabel: "Fungua Structure",
    },
  },
  {
    id: "who-sees-what",
    title: "Who can see whose customers",
    category: "people",
    asks: ["who sees what", "why can't i see", "why cant i see all borrowers", "data scope", "visibility", "officer sees own", "branch manager sees", "regional manager", "why is my list empty", "missing borrowers", "can't see other officers customers"],
    body:
      "There are two separate questions, and roles answer both. What a person may DO is their rights. WHOSE customers they may do it to is their role's visibility, and there are four settings: only their own customers; their whole branch; their branch and everything under it (a region); or the entire organisation.\n\nThat is why a loan officer and a branch manager can have almost identical permissions and still see different lists — which is the point. An officer works their own book.",
    steps: [
      "Open Access → Roles & Rights and pick a role.",
      "Under 'Whose customers can they see?', choose the visibility that matches the job.",
      "A loan officer is normally 'only their own'; a branch manager 'their whole branch'; a regional manager 'their branch and everything under it'; head office 'the entire organisation'.",
    ],
    action: { label: "Open Roles & Rights", href: "/console/roles" },
    right: "roles.view",
    related: ["branches-build", "team-invite"],
    sw: {
      title: "Nani anaweza kuona wateja wa nani",
      asks: ["nani anaona nini", "kwa nini sioni wateja wote", "sioni wakopaji wote", "upeo wa data", "orodha yangu iko tupu", "wateja wanakosekana", "afisa anaona wake tu"],
      body:
        "Kuna maswali mawili tofauti, na majukumu hujibu yote mawili. Mtu anachoweza KUFANYA ni haki zake. Wateja wa NANI anaoweza kuwafanyia ni upeo wa uonaji wa jukumu lake, na kuna mipangilio minne: wateja wake pekee; tawi lake lote; tawi lake na kila kilicho chini yake (eneo); au shirika zima.\n\nNdiyo maana afisa wa mikopo na meneja wa tawi wanaweza kuwa na ruhusa zinazofanana karibu kabisa na bado waone orodha tofauti — na ndilo lengo. Afisa hufanyia kazi kitabu chake mwenyewe.",
      steps: [
        "Fungua Access → Roles & Rights kisha uchague jukumu.",
        "Chini ya 'Whose customers can they see?', chagua upeo unaolingana na kazi.",
        "Afisa wa mikopo kwa kawaida ni 'wake pekee'; meneja wa tawi 'tawi lake lote'; meneja wa eneo 'tawi lake na kila kilicho chini yake'; makao makuu 'shirika zima'.",
      ],
      actionLabel: "Fungua Roles & Rights",
    },
  },
  {
    id: "team-invite",
    title: "Adding staff and giving them a role",
    category: "people",
    asks: ["add staff", "invite", "new user", "new agent", "add officer", "team", "add employee", "create user", "staff account", "new loan officer"],
    body:
      "Invite them from Team, give them a role and a branch, and they get an email with a temporary password. The role decides what they can do and whose customers they see; the branch decides where their work belongs.",
    steps: [
      "Open Access → Team, then 'Invite'.",
      "Enter their name and email, pick their role, and pick their branch.",
      "Set their approval tier if they will approve loans — Initiator, Authoriser or Validator.",
      "They receive their credentials by email and are asked to change the password on first sign-in.",
    ],
    action: { label: "Open Team", href: "/console/team" },
    right: "team.view",
    related: ["who-sees-what", "roles-explain"],
    sw: {
      title: "Kuongeza wafanyakazi na kuwapa majukumu",
      asks: ["ongeza mfanyakazi", "ninawezaje kuongeza mfanyakazi", "alika mfanyakazi", "mtumiaji mpya", "ongeza afisa", "timu yangu", "akaunti ya mfanyakazi", "afisa mpya wa mikopo"],
      body:
        "Waalike kutoka Team, wape jukumu na tawi, nao hupokea barua pepe yenye nenosiri la muda. Jukumu huamua wanachoweza kufanya na wateja wa nani wanaowaona; tawi huamua kazi yao inakaa wapi.",
      steps: [
        "Fungua Access → Team, kisha 'Invite'.",
        "Weka jina na barua pepe yao, chagua jukumu lao, na uchague tawi lao.",
        "Weka ngazi yao ya idhini ikiwa wataidhinisha mikopo — Initiator, Authoriser au Validator.",
        "Wanapokea vitambulisho vyao kwa barua pepe na kuombwa kubadilisha nenosiri mara ya kwanza wanapoingia.",
      ],
      actionLabel: "Fungua Team",
    },
  },
  {
    id: "roles-explain",
    title: "Roles, rights and approval tiers",
    category: "people",
    asks: ["roles", "rights", "permissions", "access", "what can they do", "tiers", "initiator", "authoriser", "validator", "maker checker", "change permissions"],
    body:
      "A role is a set of permissions plus a visibility setting. Approval TIERS are a separate thing again: Initiator (starts a loan), Authoriser (approves in the middle) and Validator (finalises). Separation of duties means whoever originates a loan should not be the one who releases the money — the disbursement queue enforces that automatically once you have two active staff.",
    action: { label: "Open Roles & Rights", href: "/console/roles" },
    right: "roles.view",
    related: ["who-sees-what", "workflow-setup", "disburse-how"],
    sw: {
      title: "Majukumu, haki na ngazi za idhini",
      asks: ["majukumu", "haki za wafanyakazi", "ruhusa", "wanaweza kufanya nini", "ngazi za idhini", "badilisha ruhusa", "jukumu langu"],
      body:
        "Jukumu ni seti ya ruhusa pamoja na upeo wa uonaji. NGAZI za idhini ni jambo tofauti tena: Initiator (huanzisha mkopo), Authoriser (huidhinisha katikati) na Validator (hukamilisha). Mgawanyo wa majukumu humaanisha anayeanzisha mkopo hapaswi kuwa anayetoa pesa — foleni ya utoaji hulisimamia hilo kiotomatiki mara tu unapokuwa na wafanyakazi wawili walio hai.",
      actionLabel: "Fungua Roles & Rights",
    },
  },

  // ── Lending ────────────────────────────────────────────────────────────────
  {
    id: "product-create",
    title: "Creating a loan product",
    category: "lending",
    asks: ["create a product", "new product", "loan product", "add product", "set interest", "interest rate", "design a loan", "pricing", "loan type"],
    body:
      "A product is the contract you lend on: how much, for how long, at what rate, and which workflow approves it. Start narrow — a tight amount band on a first cohort lets you learn cheaply before you scale exposure.",
    steps: [
      "Open Organisation → Products, then 'New product'.",
      "Set the minimum and maximum principal, the interest rate and the repayment period.",
      "Choose the interest method: FLAT is simpler for short tenors; REDUCING BALANCE is fairer on longer ones and lets a borrower save by paying early.",
      "Choose how the money is paid out: to the borrower's M-Pesa, or to a third party (a school's paybill, for school-fees lending).",
      "Attach an approval workflow, or leave it and the built-in two-tier default applies.",
    ],
    action: { label: "Open Products", href: "/console/products" },
    right: "products.view",
    related: ["workflow-setup", "apply-how"],
    sw: {
      title: "Kutengeneza bidhaa ya mkopo",
      asks: ["tengeneza bidhaa", "bidhaa mpya", "bidhaa ya mkopo", "ongeza bidhaa", "weka riba", "kiwango cha riba", "aina ya mkopo", "bei ya mkopo"],
      body:
        "Bidhaa ni mkataba unaokopesha kwao: kiasi gani, kwa muda gani, kwa riba gani, na mtiririko gani wa idhini unaouidhinisha. Anza kwa wembamba — kiwango finyu cha kiasi kwa kundi la kwanza hukuwezesha kujifunza kwa gharama ndogo kabla ya kupanua.",
      steps: [
        "Fungua Organisation → Products, kisha 'New product'.",
        "Weka kiwango cha chini na cha juu cha mtaji, riba na kipindi cha malipo.",
        "Chagua mbinu ya riba: FLAT ni rahisi kwa mikopo mifupi; REDUCING BALANCE ni ya haki zaidi kwa mirefu na humwezesha mkopaji kuokoa kwa kulipa mapema.",
        "Chagua jinsi pesa inavyotolewa: kwa M-Pesa ya mkopaji, au kwa mhusika wa tatu (paybill ya shule, kwa mikopo ya karo).",
        "Ambatanisha mtiririko wa idhini, au uache na ule wa kawaida wa ngazi mbili utatumika.",
      ],
      actionLabel: "Fungua Products",
    },
  },
  {
    id: "apply-how",
    title: "Applying for a loan on a borrower's behalf",
    category: "lending",
    asks: ["apply for a loan", "how do i apply", "new application", "walk in customer", "counter application", "assisted application", "apply on behalf", "create loan application", "how to apply a loan"],
    body:
      "A borrower can apply themselves on your portal, or you can do it for them at the counter. Either way the application enters the same approval workflow — nothing is booked until it is approved and the borrower signs an offer.",
    steps: [
      "Register the customer first if they are new: Borrowers → New Borrower.",
      "Verify their identity — no money can be disbursed to an unverified borrower.",
      "Open Loans → Apply for a Borrower, choose them and the product, and enter the amount.",
      "The application appears in the Applications Queue for a decision.",
    ],
    action: { label: "Apply for a borrower", href: "/console/applications?apply=1" },
    right: "loans.apply",
    related: ["kyc-verify", "approve-how", "borrower-add"],
    sw: {
      title: "Kumwombea mkopaji mkopo",
      asks: ["ninawezaje kuomba mkopo", "omba mkopo kwa niaba", "ombi jipya la mkopo", "mteja aliyefika ofisini", "ombi la kaunta", "jinsi ya kuomba mkopo"],
      body:
        "Mkopaji anaweza kujiombea mwenyewe kwenye tovuti yako, au wewe umwombee pale kaunta. Kwa vyovyote ombi huingia kwenye mtiririko uleule wa idhini — hakuna kinachoandikwa vitabuni hadi liidhinishwe na mkopaji atie sahihi ofa.",
      steps: [
        "Msajili mteja kwanza ikiwa ni mgeni: Borrowers → New Borrower.",
        "Thibitisha utambulisho wao — hakuna pesa inayoweza kutolewa kwa mkopaji ambaye hajathibitishwa.",
        "Fungua Loans → Apply for a Borrower, mchague yeye na bidhaa, kisha uweke kiasi.",
        "Ombi huonekana kwenye Applications Queue kwa uamuzi.",
      ],
      actionLabel: "Omba kwa niaba ya mkopaji",
    },
  },
  {
    id: "borrower-add",
    title: "Registering a new customer",
    category: "lending",
    asks: ["add a borrower", "new borrower", "register customer", "onboard customer", "new customer", "create borrower", "capture customer"],
    body:
      "Register them from the console when they are standing at your counter. Their phone number is their identity here — it is how they receive codes, how they repay, and how the system recognises them next time. The officer who registers a customer owns them: they appear on that officer's book.",
    steps: [
      "Open Borrowers → New Borrower.",
      "Capture their name, phone and ID number.",
      "Save, then verify their identity — registration alone does not let them receive money.",
    ],
    action: { label: "Register a borrower", href: "/console/borrowers?new=1" },
    right: "borrowers.create",
    related: ["kyc-verify", "apply-how"],
    sw: {
      title: "Kusajili mteja mpya",
      asks: ["ongeza mkopaji", "mkopaji mpya", "sajili mteja", "mteja mpya", "ninawezaje kusajili mteja", "andikisha mteja"],
      body:
        "Wasajili kutoka kwenye console wanaposimama kaunta yako. Nambari yao ya simu ndiyo utambulisho wao hapa — ndivyo wanavyopokea nambari za uthibitisho, ndivyo wanavyolipa, na ndivyo mfumo unavyowatambua wakati ujao. Afisa anayemsajili mteja ndiye mwenyewe: huonekana kwenye kitabu cha afisa huyo.",
      steps: [
        "Fungua Borrowers → New Borrower.",
        "Chukua jina lao, simu na nambari ya kitambulisho.",
        "Hifadhi, kisha uthibitishe utambulisho wao — usajili pekee hauwaruhusu kupokea pesa.",
      ],
      actionLabel: "Sajili mkopaji",
    },
  },
  {
    id: "kyc-verify",
    title: "Verifying a customer's identity (KYC)",
    category: "lending",
    asks: ["kyc", "verify a customer", "verification", "identity", "borrower is blocked", "why is my borrower blocked", "id check", "verify borrower", "unverified", "cannot disburse", "id verification", "liveness", "face match"],
    body:
      "Verification is the gate between a customer and their money: nobody who is unverified can be disbursed to. It proves the person is real, that the ID is theirs, and that they are physically present — the ID is checked for quality, the face is matched to it, and a liveness check makes sure it is a living person and not a photograph.\n\nEveryone you have registered but not verified sits in one queue. It should be short and cleared daily.",
    steps: [
      "Open Borrowers → KYC Verification. Everyone waiting is there, oldest first.",
      "For a customer in front of you, click 'Verify at the counter' — they confirm the code sent to their phone, then you capture their ID and face.",
      "For someone who is not there, click 'Send link' and they complete it on their own phone.",
      "Once verified they leave the queue, and their loan can be paid out.",
    ],
    action: { label: "Open KYC Verification", href: "/console/kyc" },
    right: "borrowers.view",
    related: ["disburse-how", "borrower-add"],
    sw: {
      title: "Kuthibitisha utambulisho wa mteja (KYC)",
      asks: ["thibitisha mteja", "uthibitisho wa utambulisho", "mkopaji amezuiliwa", "kwa nini mkopaji wangu amezuiliwa", "ukaguzi wa kitambulisho", "hajathibitishwa", "ulinganisho wa uso", "ukaguzi wa uhai"],
      body:
        "Uthibitisho ndilo lango kati ya mteja na pesa zao: hakuna asiyethibitishwa anayeweza kutumiwa pesa. Huthibitisha kuwa mtu ni halisi, kitambulisho ni chao, na wapo pale kimwili — kitambulisho hukaguliwa ubora, uso hulinganishwa nacho, na ukaguzi wa uhai huhakikisha ni mtu hai wala si picha.\n\nKila uliyemsajili bila kumthibitisha hukaa kwenye foleni moja. Inapaswa kuwa fupi na kusafishwa kila siku.",
      steps: [
        "Fungua Borrowers → KYC Verification. Kila anayesubiri yupo pale, wa zamani zaidi kwanza.",
        "Kwa mteja aliye mbele yako, bofya 'Verify at the counter' — yeye huthibitisha nambari iliyotumwa kwa simu yake, kisha wewe upige picha ya kitambulisho na uso wake.",
        "Kwa asiyekuwepo, bofya 'Send link' naye akamilishe kwenye simu yake mwenyewe.",
        "Akishathibitishwa hutoka kwenye foleni, na mkopo wake waweza kulipwa.",
      ],
      actionLabel: "Fungua KYC Verification",
    },
  },
  {
    id: "approve-how",
    title: "Approving, referring or declining an application",
    category: "lending",
    asks: ["approve", "approve a loan", "decline", "refer", "applications queue", "decision", "how do i approve", "review application", "reject"],
    body:
      "Applications sit in the queue until someone decides. The workflow decides who — an officer at the first stage, a validator at the last. The final stage can require a code sent to your email before it will let you finalise, so a large loan cannot be approved by someone who merely walked past an unlocked screen.",
    steps: [
      "Open Loans → Applications Queue.",
      "Open the application. You will see the credit score, the reasons behind it, and the borrower's history.",
      "Approve, refer for more information, or decline. A decline should have a reason — the borrower is entitled to it and the model learns from it.",
      "After final approval the borrower must SIGN an offer before anything is booked.",
    ],
    action: { label: "Open the queue", href: "/console/applications" },
    right: "applications.view",
    related: ["offer-sign", "workflow-setup", "scoring-explain"],
    sw: {
      title: "Kuidhinisha, kurudisha au kukataa ombi",
      asks: ["idhinisha mkopo", "ninaidhinishaje", "kataa ombi", "rudisha ombi", "foleni ya maombi", "kagua ombi", "uamuzi wa mkopo"],
      body:
        "Maombi hukaa kwenye foleni hadi mtu aamue. Mtiririko huamua nani — afisa katika hatua ya kwanza, validator katika ya mwisho. Hatua ya mwisho inaweza kuhitaji nambari inayotumwa kwa barua pepe yako kabla ya kukuruhusu kukamilisha, ili mkopo mkubwa usiidhinishwe na mtu aliyepita tu karibu na skrini iliyo wazi.",
      steps: [
        "Fungua Loans → Applications Queue.",
        "Fungua ombi. Utaona alama ya mkopo, sababu zilizo nyuma yake, na historia ya mkopaji.",
        "Idhinisha, rudisha kwa taarifa zaidi, au kataa. Kukataa kunapaswa kuwa na sababu — ni haki ya mkopaji na mfumo hujifunza kutokana nayo.",
        "Baada ya idhini ya mwisho mkopaji LAZIMA atie sahihi ofa kabla ya chochote kuandikwa vitabuni.",
      ],
      actionLabel: "Fungua foleni",
    },
  },
  {
    id: "offer-sign",
    title: "The loan offer, and why nothing books without a signature",
    category: "lending",
    asks: ["offer", "signature", "sign", "why is the loan not booked", "accept offer", "loan agreement", "consent"],
    body:
      "No loan is written onto your book without the borrower agreeing to its terms. After final approval an offer is created with the exact terms frozen onto it — repricing the product afterwards cannot change what they signed.\n\nThey can sign two ways: on their phone, by entering a code that names the amount and the total repayable; or on paper at your branch, recorded by a staff member under their own name with a note of the evidence. There is no way for staff to fake a phone signature.",
    action: { label: "Open the queue", href: "/console/applications" },
    right: "applications.decide",
    related: ["approve-how", "disburse-how"],
    sw: {
      title: "Ofa ya mkopo, na kwa nini hakuna kinachoandikwa bila sahihi",
      asks: ["ofa ya mkopo", "sahihi ya mkopaji", "tia sahihi", "kwa nini mkopo haujaandikwa", "kubali ofa", "mkataba wa mkopo"],
      body:
        "Hakuna mkopo unaoandikwa kwenye kitabu chako bila mkopaji kukubali masharti yake. Baada ya idhini ya mwisho ofa hutengenezwa na masharti kamili kugandishwa juu yake — kubadilisha bei ya bidhaa baadaye hakuwezi kubadilisha alichotia sahihi.\n\nWanaweza kutia sahihi kwa njia mbili: kwenye simu yao, kwa kuweka nambari inayotaja kiasi na jumla ya kulipwa; au kwa karatasi tawini, ikirekodiwa na mfanyakazi kwa jina lake mwenyewe pamoja na maelezo ya ushahidi. Hakuna njia ya wafanyakazi kughushi sahihi ya simu.",
      actionLabel: "Fungua foleni",
    },
  },
  {
    id: "workflow-setup",
    title: "Setting up an approval workflow",
    category: "lending",
    asks: ["workflow", "approval chain", "stages", "who approves", "two tier", "approval process", "maker checker", "set up approvals"],
    body:
      "A workflow is the chain a loan walks: who sees it first, who finalises it, and whether a code is required at the end. The point is separation of duties — whoever originates a loan should never be the one who finalises the money.",
    steps: [
      "Open Organisation → Workflows.",
      "Build a chain: an Initiator stage for the officer, then a Validator stage that can finalise.",
      "Turn on the code requirement on the finalising stage, and set an amount cap so larger loans need a higher authority.",
      "Assign the workflow to your products. New and repeat borrowers can use different chains.",
    ],
    action: { label: "Open Workflows", href: "/console/workflows" },
    right: "workflows.view",
    related: ["roles-explain", "product-create"],
    sw: {
      title: "Kuweka mtiririko wa idhini",
      asks: ["mtiririko wa idhini", "mlolongo wa idhini", "hatua za idhini", "nani huidhinisha", "ngazi mbili za idhini", "mchakato wa idhini"],
      body:
        "Mtiririko ni mlolongo mkopo unaoupita: nani anauona kwanza, nani anaukamilisha, na kama nambari inahitajika mwishoni. Lengo ni mgawanyo wa majukumu — anayeanzisha mkopo asiwe kamwe anayekamilisha pesa.",
      steps: [
        "Fungua Organisation → Workflows.",
        "Jenga mlolongo: hatua ya Initiator kwa afisa, kisha hatua ya Validator inayoweza kukamilisha.",
        "Washa sharti la nambari kwenye hatua inayokamilisha, na uweke kikomo cha kiasi ili mikopo mikubwa ihitaji mamlaka ya juu zaidi.",
        "Weka mtiririko kwenye bidhaa zako. Wakopaji wapya na wanaorudi wanaweza kutumia milolongo tofauti.",
      ],
      actionLabel: "Fungua Workflows",
    },
  },

  // ── Money ──────────────────────────────────────────────────────────────────
  {
    id: "disburse-how",
    title: "Paying out a loan",
    category: "money",
    asks: ["disburse", "disbursement", "pay out", "payout", "release money", "send money", "how do i disburse", "b2c", "cannot pay out"],
    body:
      "Approved loans arrive in the disbursement queue. One person initiates and a different person confirms — the queue enforces that as soon as you have two active staff. The money is checked against your float first, so you cannot promise what you do not have.\n\nTwo things will stop a payout: the borrower is not KYC-verified, or your float is short.",
    steps: [
      "Open Payments → Disbursements & Float.",
      "Check your float balance. Top it up if it is short.",
      "Initiate the payout, then have a second person confirm it.",
      "If you do not have M-Pesa B2C credentials, use the manual path: pay outside the system, record the M-Pesa reference, and the loan still activates cleanly.",
    ],
    action: { label: "Open Disbursements", href: "/console/disbursements" },
    right: "disbursements.view",
    related: ["kyc-verify", "float-explain", "vault-setup"],
    sw: {
      title: "Kutoa pesa za mkopo",
      asks: ["toa pesa", "utoaji wa mkopo", "ninatoaje pesa", "kwa nini siwezi kutoa pesa", "tuma pesa kwa mkopaji", "kulipa mkopaji"],
      body:
        "Mikopo iliyoidhinishwa hufika kwenye foleni ya utoaji. Mtu mmoja huanzisha na mtu tofauti huthibitisha — foleni hulisimamia hilo mara tu unapokuwa na wafanyakazi wawili walio hai. Pesa hukaguliwa dhidi ya float yako kwanza, ili usiahidi usichonacho.\n\nMambo mawili yatasimamisha utoaji: mkopaji hajathibitishwa KYC, au float yako imepungua.",
      steps: [
        "Fungua Payments → Disbursements & Float.",
        "Angalia salio la float yako. Liongeze likiwa limepungua.",
        "Anzisha utoaji, kisha mtu wa pili athibitishe.",
        "Ikiwa huna vitambulisho vya M-Pesa B2C, tumia njia ya mkono: lipa nje ya mfumo, rekodi kumbukumbu ya M-Pesa, na mkopo bado huwashwa vizuri.",
      ],
      actionLabel: "Fungua Disbursements",
    },
  },
  {
    id: "float-explain",
    title: "Float — the money you lend from",
    category: "money",
    asks: ["float", "top up", "balance", "why can't i disburse", "not enough float", "fund account", "treasury"],
    body:
      "Float is your own working capital sitting on the disbursement rail. Every payout debits it and every top-up credits it, in a ledger you can read line by line. The queue refuses to disburse below your balance, which is the point — a stalled disbursement is a broken promise to a borrower who already counted on the money.",
    action: { label: "Open Float", href: "/console/disbursements" },
    right: "float.view",
    related: ["disburse-how"],
    sw: {
      title: "Float — pesa unazokopesha kutoka kwazo",
      asks: ["float yangu", "ongeza float", "salio la float", "float haitoshi", "mtaji wa kukopesha"],
      body:
        "Float ni mtaji wako wa kazi uliokaa kwenye njia ya utoaji. Kila utoaji huipunguza na kila nyongeza huiongeza, kwenye leja unayoweza kuisoma mstari kwa mstari. Foleni hukataa kutoa zaidi ya salio lako, na ndilo lengo — utoaji uliokwama ni ahadi iliyovunjwa kwa mkopaji aliyekwisha kuzitegemea pesa hizo.",
      actionLabel: "Fungua Float",
    },
  },
  {
    id: "repay-how",
    title: "How borrowers repay, and how to chase them",
    category: "money",
    asks: ["repayment", "repay", "collect", "payment", "how do borrowers pay", "paybill", "stk", "request payment", "collections"],
    body:
      "Money comes back two ways: the borrower pays your paybill themselves, or you send them a payment request (an STK prompt) that pops up on their phone. Both land in the same place and are allocated to the oldest unpaid installment first.",
    steps: [
      "Open Payments → Repayments to see every active loan and what it owes.",
      "Send a payment request to prompt a borrower directly on their phone.",
      "Anything that arrives without a clear owner appears in the exceptions list, where you can allocate it by hand.",
    ],
    action: { label: "Open Repayments", href: "/console/repayments" },
    right: "repayments.view",
    related: ["collections-how", "reconcile-explain"],
    sw: {
      title: "Jinsi wakopaji wanavyolipa, na jinsi ya kuwafuatilia",
      asks: ["malipo ya mkopo", "wakopaji wanalipaje", "kusanya malipo", "ombi la malipo", "ukusanyaji wa madeni", "lipa kwa paybill"],
      body:
        "Pesa hurudi kwa njia mbili: mkopaji hulipa paybill yako mwenyewe, au unamtumia ombi la malipo (STK) linalotokea kwenye simu yake. Zote hufika mahali pamoja na kupangwa kwa awamu ya zamani zaidi isiyolipwa kwanza.",
      steps: [
        "Fungua Payments → Repayments kuona kila mkopo hai na kinachodaiwa.",
        "Tuma ombi la malipo kumfikia mkopaji moja kwa moja kwenye simu yake.",
        "Chochote kinachofika bila mwenyewe aliye wazi huonekana kwenye orodha ya matatizo, ambako unaweza kukipanga kwa mkono.",
      ],
      actionLabel: "Fungua Repayments",
    },
  },
  {
    id: "reconcile-explain",
    title: "Reconciliation — money that does not tie out",
    category: "money",
    asks: ["reconciliation", "reconcile", "exception", "unallocated", "missing payment", "money doesn't match", "drift"],
    body:
      "Every night the platform re-checks its own arithmetic: receipts that were never allocated to a loan, payouts that never confirmed, duplicates, and float that does not tie out. Anything that fails becomes an exception with a plain reason. Resolving one requires a note — a reconciliation you cannot explain later is not a reconciliation.",
    action: { label: "Open Reconciliation", href: "/console/reconciliation" },
    right: "reconciliation.view",
    sw: {
      title: "Usuluhishi — pesa isiyolingana",
      asks: ["usuluhishi wa hesabu", "malipo yanakosekana", "pesa hailingani", "risiti haijapangwa", "hesabu hazilingani"],
      body:
        "Kila usiku jukwaa hukagua upya hesabu zake lenyewe: risiti ambazo hazikupangwa kwa mkopo wowote, malipo ambayo hayakuthibitika, nakala mbili, na float isiyolingana. Chochote kinachoshindwa huwa tatizo lenye sababu wazi. Kulitatua kunahitaji maelezo — usuluhishi usioweza kuelezwa baadaye si usuluhishi.",
      actionLabel: "Fungua Reconciliation",
    },
  },
  {
    id: "vault-setup",
    title: "Connecting M-Pesa, SMS and other credentials",
    category: "account",
    asks: ["vault", "credentials", "mpesa", "daraja", "connect mpesa", "sms provider", "api keys", "settings", "integrations", "configure"],
    body:
      "Your credentials live in an encrypted vault, one set per lender — we never hold them in a shared config. You need M-Pesa for collecting (paybill) and, if you want automatic payouts, for disbursing (B2C). Without B2C you can still lend: you pay out manually and record the reference.",
    steps: [
      "Open Organisation → Settings & Vault.",
      "Enter your Daraja credentials for STK (collections) and B2C (payouts).",
      "Add an SMS provider so your borrowers receive their codes and reminders.",
      "Credentials are write-only: once saved, nobody — including us — can read them back out of the screen.",
    ],
    action: { label: "Open Settings & Vault", href: "/console/settings" },
    right: "settings.view",
    related: ["disburse-how", "sms-credits"],
    sw: {
      title: "Kuunganisha M-Pesa, SMS na vitambulisho vingine",
      asks: ["unganisha mpesa", "vitambulisho vya daraja", "mtoa huduma wa sms", "mipangilio ya pesa", "sanidi mpesa", "funguo za api"],
      body:
        "Vitambulisho vyako hukaa kwenye vault iliyofichwa, seti moja kwa kila mkopeshaji — hatuvishiki kamwe kwenye usanidi wa pamoja. Unahitaji M-Pesa kwa kukusanya (paybill) na, ukitaka malipo ya kiotomatiki, kwa kutoa (B2C). Bila B2C bado unaweza kukopesha: unalipa kwa mkono na kurekodi kumbukumbu.",
      steps: [
        "Fungua Organisation → Settings & Vault.",
        "Weka vitambulisho vyako vya Daraja kwa STK (ukusanyaji) na B2C (utoaji).",
        "Ongeza mtoa huduma wa SMS ili wakopaji wako wapokee nambari zao na vikumbusho.",
        "Vitambulisho ni vya kuandika tu: vikishahifadhiwa, hakuna mtu — hata sisi — anayeweza kuvisoma tena kutoka skrini.",
      ],
      actionLabel: "Fungua Settings & Vault",
    },
  },

  // ── Collections ────────────────────────────────────────────────────────────
  {
    id: "collections-how",
    title: "Chasing arrears",
    category: "collections",
    asks: ["arrears", "overdue", "chase", "collections queue", "promise to pay", "ptp", "late borrower", "defaulter", "follow up"],
    body:
      "The work queue is derived live from the book: every loan with an overdue installment, freshest arrears first — because a loan one week late is far more recoverable than one three months late, and most systems sort them the other way round.\n\nA promise to pay is settled by MONEY, not by opinion: when the date arrives, the platform compares what actually came in and marks the promise kept, partial or broken.",
    steps: [
      "Open Collections → Work Queue.",
      "Call the borrower, log the call and its outcome.",
      "If they commit to a date and an amount, record it as a promise to pay.",
      "Raise a ticket for a genuine dispute or hardship case rather than chasing them harder.",
    ],
    action: { label: "Open Collections", href: "/console/collections" },
    right: "collections.view",
    related: ["repay-how", "early-warning"],
    sw: {
      title: "Kufuatilia madeni yaliyochelewa",
      asks: ["madeni yaliyochelewa", "mkopaji amechelewa kulipa", "fuatilia madeni", "ahadi ya kulipa", "mdaiwa sugu", "foleni ya ukusanyaji"],
      body:
        "Foleni ya kazi hutokana moja kwa moja na kitabu: kila mkopo wenye awamu iliyochelewa, ucheleweshaji mpya zaidi kwanza — kwa sababu mkopo uliochelewa wiki moja unarudishika zaidi kuliko wa miezi mitatu, na mifumo mingi huipanga kinyume.\n\nAhadi ya kulipa huamuliwa kwa PESA, si kwa maoni: tarehe inapofika, jukwaa hulinganisha kilichoingia halisi na kuiweka ahadi kuwa imetimizwa, nusu au imevunjwa.",
      steps: [
        "Fungua Collections → Work Queue.",
        "Mpigie mkopaji simu, rekodi simu na matokeo yake.",
        "Wakikubali tarehe na kiasi, irekodi kama ahadi ya kulipa.",
        "Fungua tiketi kwa mgogoro halisi au shida ya kimaisha badala ya kuwafuatilia zaidi.",
      ],
      actionLabel: "Fungua Collections",
    },
  },

  // ── Intelligence ───────────────────────────────────────────────────────────
  {
    id: "scoring-explain",
    title: "How credit scoring works here",
    category: "intelligence",
    asks: ["credit score", "scoring", "how is the score calculated", "pd", "risk band", "how do you score", "credit assessment", "why was this declined"],
    body:
      "A first-time applicant is scored on their M-Pesa cashflow — we read their statement and measure what actually goes in and out, rather than asking them to describe it. A returning borrower is scored on that PLUS their repayment history with you, which is the strongest signal there is.\n\nEvery score carries its reasons. A decline you cannot explain to a borrower is one you cannot defend to a regulator either.",
    action: { label: "Open the applications queue", href: "/console/applications" },
    right: "applications.view",
    related: ["approve-how", "early-warning"],
    sw: {
      title: "Jinsi upimaji wa mikopo unavyofanya kazi hapa",
      asks: ["alama ya mkopo", "upimaji wa mikopo", "alama inakokotolewaje", "mnapimaje wakopaji", "kwa nini ombi lilikataliwa"],
      body:
        "Mwombaji wa mara ya kwanza hupimwa kwa mtiririko wa pesa zake za M-Pesa — tunasoma taarifa yake na kupima kinachoingia na kutoka halisi, badala ya kumwomba aeleze. Mkopaji anayerudi hupimwa kwa hicho PAMOJA NA historia yake ya malipo kwako, ambayo ndiyo ishara yenye nguvu zaidi iliyopo.\n\nKila alama hubeba sababu zake. Kukataa usikoweza kumweleza mkopaji ni kukataa usikoweza kukutetea kwa msimamizi pia.",
      actionLabel: "Fungua foleni ya maombi",
    },
  },
  {
    id: "early-warning",
    title: "Early warning — who is about to go bad",
    category: "intelligence",
    asks: ["early warning", "watchlist", "who will default", "risk", "portfolio risk", "at risk borrowers", "predict default"],
    body:
      "Every active loan is scored for the early signs of trouble: how late they are, how many installments they have missed, what the model thought of them at origination, and structural risk like a first-cycle borrower or an unusually large loan. Each one comes with a recommended action and a plain reason — never a number on its own.",
    action: { label: "Open Credit Intelligence", href: "/console/intelligence" },
    right: "intelligence.view",
    feature: "portfolio-scan",
    related: ["collections-how", "tuning-explain"],
    sw: {
      title: "Tahadhari ya mapema — nani anakaribia kuharibika",
      asks: ["tahadhari ya mapema", "orodha ya hatari", "nani atashindwa kulipa", "wakopaji walio hatarini", "hatari ya mkopo"],
      body:
        "Kila mkopo hai hupimwa dalili za mwanzo za matatizo: wamechelewa kiasi gani, wamekosa awamu ngapi, mfumo ulifikiria nini kuwahusu mwanzoni, na hatari ya kimuundo kama mkopaji wa mzunguko wa kwanza au mkopo mkubwa isivyo kawaida. Kila mmoja huja na hatua inayopendekezwa na sababu wazi — kamwe si nambari peke yake.",
      actionLabel: "Fungua Credit Intelligence",
    },
  },
  {
    id: "tuning-explain",
    title: "Tuning the risk model to your book",
    category: "intelligence",
    asks: ["tuning", "model tuning", "change weights", "adjust risk", "customise risk", "risk policy"],
    body:
      "Every lender's book behaves differently. A fourteen-day delay is normal breathing at a market-stall lender and an alarm at a payroll lender. You can move the weights — and see exactly which borrowers fall off the watchlist BEFORE you save, against your own real book.\n\nTuning changes who an officer calls first. It can never change what a borrower owes.",
    action: { label: "Open Model Tuning", href: "/console/intelligence/tuning" },
    right: "intelligence.tune",
    feature: "model-tuning",
    sw: {
      title: "Kurekebisha mfumo wa hatari kulingana na kitabu chako",
      asks: ["rekebisha mfumo wa hatari", "badilisha uzito wa hatari", "sera ya hatari", "urekebishaji wa modeli"],
      body:
        "Kitabu cha kila mkopeshaji huenenda tofauti. Ucheleweshaji wa siku kumi na nne ni upumuaji wa kawaida kwa mkopeshaji wa soko na kengele kwa mkopeshaji wa mishahara. Unaweza kusogeza uzito — na kuona ni wakopaji gani wanaotoka kwenye orodha ya hatari KABLA ya kuhifadhi, dhidi ya kitabu chako halisi.\n\nUrekebishaji hubadilisha afisa anampigia nani kwanza. Hauwezi kamwe kubadilisha mkopaji anadaiwa nini.",
      actionLabel: "Fungua Model Tuning",
    },
  },
  {
    id: "riri-analyst",
    title: "Asking Riri about your numbers",
    category: "intelligence",
    asks: ["riri analyst", "ask about my numbers", "olb", "par", "how much did we collect", "analytics", "reports", "talk to my data", "my book"],
    body:
      "Switch me to ANALYST and I read your live book: outstanding, PAR 30, disbursements, collections, defaults, your pipeline. Ask for a period ('collected last month'), a slice ('PAR by product'), a ranking ('top 5 borrowers') or a trend ('disbursements over time').\n\nEvery answer shows you the exact query it came from. If you cannot check a number, you should not act on it.",
    action: { label: "Open Reports", href: "/console/report" },
    right: "riri.use",
    feature: "riri",
    related: ["metrics-catalogue"],
    sw: {
      title: "Kumwuliza Riri kuhusu takwimu zako",
      asks: ["uliza kuhusu takwimu zangu", "tulikusanya kiasi gani", "takwimu za kitabu changu", "ripoti za mikopo", "ongea na data yangu"],
      body:
        "Nibadilishe kuwa ANALYST nami nasoma kitabu chako halisi: kinachodaiwa, PAR 30, utoaji, makusanyo, waliokwama, na maombi yanayosubiri. Uliza kwa kipindi ('tulikusanya mwezi uliopita'), kwa mgawanyo ('PAR kwa bidhaa'), kwa orodha ('wakopaji 5 bora') au mwenendo ('utoaji kwa muda').\n\nKila jibu hukuonyesha swali kamili lililotumika. Usipoweza kuihakiki nambari, hupaswi kuitumia.",
      actionLabel: "Fungua Ripoti",
    },
  },
  {
    id: "metrics-catalogue",
    title: "What Riri means by PAR 30 (and teaching her your words)",
    category: "intelligence",
    asks: ["metric catalogue", "what does par mean", "definitions", "teach riri", "synonyms", "targets", "what does riri know"],
    body:
      "The Metric Catalogue lists every measure I know, what it counts in plain English, and the exact SQL behind it. You can rename a measure to whatever your staff actually call it, teach me your words ('delinquency', 'my book'), and set the target you hold yourself to — I will tell you whether you are inside it every time I quote the number.\n\nWhat you cannot change is the arithmetic. PAR 30 is a number you report to a regulator; it is not ours or yours to bend.",
    action: { label: "Open the Metric Catalogue", href: "/console/intelligence/metrics" },
    right: "metrics.view",
    feature: "riri",
    sw: {
      title: "Riri anamaanisha nini kwa PAR 30 (na kumfundisha maneno yako)",
      asks: ["par inamaanisha nini", "katalogi ya vipimo", "fafanuzi za vipimo", "mfundishe riri maneno yangu", "malengo ya vipimo"],
      body:
        "Katalogi ya Vipimo huorodhesha kila kipimo ninachokijua, kinahesabu nini kwa lugha rahisi, na SQL kamili iliyo nyuma yake. Unaweza kubadilisha jina la kipimo kuwa lile wafanyakazi wako wanalolitumia kweli, kunifundisha maneno yako, na kuweka lengo unalojiwekea — nitakuambia kama uko ndani yake kila ninapoitaja nambari hiyo.\n\nUsichoweza kubadilisha ni hesabu. PAR 30 ni nambari unayoiripoti kwa msimamizi; si yetu wala yako kuipinda.",
      actionLabel: "Fungua Katalogi ya Vipimo",
    },
  },

  // ── Account ────────────────────────────────────────────────────────────────
  {
    id: "billing-upgrade",
    title: "Packages, paying, and upgrading",
    category: "account",
    asks: ["upgrade", "package", "plan", "pay", "billing", "subscription", "how much", "price", "invoice", "cost", "change plan", "payment"],
    body:
      "There are four packages — Starter, Enterprise, Advanced and Premium — and they differ in which intelligence tools you get, not in whether your loan book works. That distinction matters: if a payment is ever late you lose the metered AI tools, but your borrowers keep repaying, your officers keep collecting, and nothing about your book stops.\n\nAll payment goes through your BirgenAI wallet: one till, one ledger, one receipt.",
    steps: [
      "Open Billing → Package & Usage to see your package and what you have used this month.",
      "Choose a package and pay. Paying early does not burn the remainder of your current month — it stacks on top.",
    ],
    action: { label: "Open Billing", href: "/console/billing" },
    right: "billing.view",
    related: ["sms-credits"],
    sw: {
      title: "Vifurushi, kulipa, na kupandisha daraja",
      asks: ["pandisha daraja", "kifurushi changu", "bei ya huduma", "gharama ya jukwaa", "badilisha mpango", "malipo ya kifurushi", "ankara"],
      body:
        "Kuna vifurushi vinne — Starter, Enterprise, Advanced na Premium — na hutofautiana kwa zana za akili unazozipata, si kama kitabu chako cha mikopo kinafanya kazi. Tofauti hiyo ni muhimu: malipo yakiwahi kuchelewa unapoteza zana za AI zinazopimwa, lakini wakopaji wako wanaendelea kulipa, maafisa wako wanaendelea kukusanya, na hakuna kinachosimama kwenye kitabu chako.\n\nMalipo yote hupitia pochi yako ya BirgenAI: till moja, leja moja, risiti moja.",
      steps: [
        "Fungua Billing → Package & Usage kuona kifurushi chako na ulichokitumia mwezi huu.",
        "Chagua kifurushi na ulipe. Kulipa mapema hakupotezi kilichosalia cha mwezi wako wa sasa — hurundikwa juu yake.",
      ],
      actionLabel: "Fungua Billing",
    },
  },
  {
    id: "sms-credits",
    title: "SMS credits",
    category: "account",
    asks: ["sms", "credits", "top up sms", "text messages", "sms bundle", "message credits", "run out of sms"],
    body:
      "SMS is prepaid, never billed in arrears. Your package includes a monthly allowance; beyond that you buy credits. If you run dry, the critical messages still go — a verification code, a signing code, a guarantor request — because a billing problem must never stop a borrower signing. Everything discretionary waits until you top up.",
    action: { label: "Buy SMS credits", href: "/console/billing" },
    right: "billing.view",
    sw: {
      title: "Salio la SMS",
      asks: ["salio la sms", "ongeza sms", "sms zimeisha", "kifurushi cha meseji", "nunua sms"],
      body:
        "SMS ni ya kulipiwa kabla, kamwe si ya kudaiwa baadaye. Kifurushi chako kina posho ya kila mwezi; zaidi ya hapo unanunua salio. Likiisha, meseji muhimu bado huenda — nambari ya uthibitisho, nambari ya kutia sahihi, ombi la mdhamini — kwa sababu tatizo la malipo halipaswi kamwe kumzuia mkopaji kutia sahihi. Kila kisicho cha lazima husubiri hadi uongeze salio.",
      actionLabel: "Nunua salio la SMS",
    },
  },
  {
    id: "branding-how",
    title: "Putting your own brand on it",
    category: "account",
    asks: ["branding", "logo", "colours", "colors", "white label", "customise", "my brand", "upload logo"],
    body:
      "Upload your logo and the platform reads its colours and rebrands itself around them — your console, your borrower portal, your SMS and your emails. Your borrowers see you, not us.",
    action: { label: "Open Branding", href: "/console/settings/branding" },
    right: "branding.manage",
    sw: {
      title: "Kuweka chapa yako mwenyewe",
      asks: ["chapa yangu", "nembo yangu", "pakia nembo", "rangi za kampuni", "weka nembo"],
      body:
        "Pakia nembo yako na jukwaa husoma rangi zake na kujibadilisha kuzizunguka — console yako, tovuti ya wakopaji wako, SMS zako na barua pepe zako. Wakopaji wako wanakuona wewe, si sisi.",
      actionLabel: "Fungua Branding",
    },
  },
  {
    id: "password-help",
    title: "Passwords and signing in",
    category: "account",
    asks: ["password", "forgot password", "reset", "can't log in", "cannot sign in", "locked out", "sign in code", "login code", "otp"],
    body:
      "Change your password from the profile menu at the top right. If you have forgotten it, use 'Forgot password' on the sign-in page and we email you a code.\n\nSigning in also asks for a daily code sent to your email. It works until midnight, so you enter it once a day and not once an hour.",
    action: { label: "Open your profile", href: "/console" },
    sw: {
      title: "Manenosiri na kuingia",
      asks: ["nenosiri", "nimesahau nenosiri", "siwezi kuingia", "nambari ya kuingia", "imenifungia nje", "weka upya nenosiri"],
      body:
        "Badilisha nenosiri lako kutoka kwenye menyu ya wasifu iliyo juu kulia. Ukilisahau, tumia 'Forgot password' kwenye ukurasa wa kuingia nasi tutakutumia nambari kwa barua pepe.\n\nKuingia pia huomba nambari ya kila siku inayotumwa kwa barua pepe yako. Hufanya kazi hadi usiku wa manane, kwa hivyo unaiweka mara moja kwa siku, si mara moja kwa saa.",
      actionLabel: "Fungua wasifu wako",
    },
  },
];

// ── Language detection ────────────────────────────────────────────────────────
//
// The question decides the language of the answer — nobody sets a preference
// flag before asking for help. STRONG markers are words that are unmistakably
// Kiswahili and load-bearing in a support question (interrogatives, the domain's
// own nouns); WEAK markers are common particles that also appear in noise. One
// strong hit or two weak ones is enough — a threshold low enough that "nifanye
// nini?" flips, high enough that "what is the par target" never does.

const SW_STRONG = new Set([
  "ninawezaje", "nawezaje", "ninaanzaje", "nifanye", "nianze", "nianzie", "niongeze", "nisajili",
  "vipi", "jinsi", "namna", "wapi", "kwanini", "siwezi", "sioni", "nimesahau", "tafadhali",
  "mkopo", "mikopo", "mkopaji", "wakopaji", "mkopeshaji", "wateja", "mteja",
  "mfanyakazi", "wafanyakazi", "tawi", "matawi", "makao",
  "malipo", "salio", "riba", "karo", "kifurushi", "vifurushi", "nembo", "chapa",
  "uthibitisho", "thibitisha", "kitambulisho", "utambulisho", "nenosiri", "idhini", "idhinisha",
  "sajili", "usajili", "ongeza", "tengeneza", "fungua", "tuma", "kusanya", "madeni", "deni",
  "ahadi", "hesabu", "takwimu", "hatari", "tahadhari", "yangu", "yetu", "zangu", "wangu",
]);

const SW_WEAK = new Set([
  "nini", "gani", "kwa", "ya", "za", "wa", "la", "cha", "vya", "na", "ni", "je",
  "kuhusu", "kwenye", "katika", "sasa", "leo", "bado", "pia", "au", "hii", "huu", "hilo",
]);

export function detectLang(question: string): SupportLang {
  const words = question.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  let strong = 0, weak = 0;
  for (const w of words) {
    if (SW_STRONG.has(w)) strong++;
    else if (SW_WEAK.has(w)) weak++;
  }
  return strong >= 1 || weak >= 2 ? "sw" : "en";
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export type Match = { article: Article; score: number };

const STOPWORDS = new Set([
  // English
  "how", "do", "i", "to", "the", "a", "an", "is", "are", "can", "you", "my", "me", "what", "where",
  "in", "on", "of", "for", "and", "it", "this", "that", "with", "please", "riri", "help",
  // Kiswahili particles — as contentless in a question as "the" and "of" are
  "ya", "za", "wa", "la", "cha", "vya", "na", "kwa", "ni", "je", "nini", "gani",
  "kwenye", "katika", "kuhusu", "yangu", "wangu", "zangu", "tafadhali", "msaada",
]);

/**
 * Score an article against a question — in BOTH languages at once.
 *
 * Weighted deliberately: an exact phrase a person would actually SAY beats a bag of
 * words that happens to overlap. "How do I disburse" should hit the payout article, not
 * every article that contains the word "loan". The Kiswahili phrasings ride the same
 * scale, so a mixed-language question ("how do I ongeza mfanyakazi") still lands.
 */
function scoreArticle(q: string, a: Article): number {
  let score = 0;

  for (const ask of a.asks) {
    if (q.includes(ask)) score = Math.max(score, 10 + ask.length); // a real phrasing
  }
  for (const ask of a.sw.asks) {
    if (q.includes(ask)) score = Math.max(score, 10 + ask.length);
  }

  const words = q.split(/[^a-z0-9']+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const hay = `${a.title} ${a.asks.join(" ")} ${a.sw.title} ${a.sw.asks.join(" ")} ${a.category}`.toLowerCase();
  for (const w of words) if (hay.includes(w)) score += 2;

  // The title is the strongest single signal short of an exact phrasing.
  if (words.some((w) => a.title.toLowerCase().includes(w) || a.sw.title.toLowerCase().includes(w))) score += 3;

  return score;
}

/**
 * THE CONFIDENCE FLOOR, and it is the most important number in this file.
 *
 * Without it, "how do I export the loan book to QuickBooks" scored five points against
 * the APPLY-FOR-A-LOAN article — on the words "loan" and "book" — and Riri cheerfully
 * explained how to take an application. That is the failure mode an AI support agent
 * must not have: the lender follows instructions that have nothing to do with what they
 * asked, finds no export anywhere, and concludes the SOFTWARE is broken.
 *
 * A real match clears this easily: any phrasing a person would actually say scores 10
 * plus its own length. A couple of common nouns brushing past each other does not. Below
 * the floor Riri says she does not know — which is a worse answer to receive and a far
 * better one to give. The floor holds for Kiswahili questions too, and the test suite
 * pins it in both languages.
 */
const MIN_SCORE = 8;

/**
 * The articles that answer this question, best first — filtered to what this person is
 * actually allowed to do.
 *
 * `rights` and `features` are the ASKER's. An article they cannot act on is not
 * withheld — it is returned flagged (see `permitted`), because "you need an
 * administrator to do that" is a genuinely useful answer and "no results" is not.
 */
export function search(
  question: string,
  opts: { rights: ReadonlySet<string>; features: ReadonlySet<string>; limit?: number } = {
    rights: new Set(), features: new Set(),
  },
): (Match & { permitted: boolean; entitled: boolean })[] {
  const q = question.toLowerCase().trim();
  if (!q) return [];

  const admin = opts.rights.has("*");
  const matches = ARTICLES
    .map((article) => ({ article, score: scoreArticle(q, article) }))
    .filter((m) => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3);

  return matches.map((m) => ({
    ...m,
    permitted: !m.article.right || admin || opts.rights.has(m.article.right),
    entitled: !m.article.feature || opts.features.has(m.article.feature),
  }));
}

export const articleById = (id: string): Article | undefined => ARTICLES.find((a) => a.id === id);

/** Everything a person may actually reach — powers the "what can I ask?" suggestions. */
export function articlesFor(rights: ReadonlySet<string>): Article[] {
  const admin = rights.has("*");
  return ARTICLES.filter((a) => !a.right || admin || rights.has(a.right));
}
