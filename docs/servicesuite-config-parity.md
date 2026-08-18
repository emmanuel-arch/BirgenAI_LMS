# ServiceSuite configuration parity, and the environment recovery plan

**Swept:** 18 August 2026, against `C:\GIT\ServiceSuite-Portal` (the live Micromart
deployment's source) and the live-server object extracts committed beside it.

Two questions are answered here:

1. **Parity** — is anything configured in the live Micromart system that this
   platform has no equivalent for?
2. **Recovery** — how do we get back the environment variables lost with the
   laptop?

The short answers: the parity gaps are three, all named below; and almost every
lost variable is recoverable, because the live system is still running on the
same values and we already hold a read-only connection to it.

---

## 1. The single most important finding

**ServiceSuite's configuration is not in a file. It is in the database.**

`appsettings.json` holds only four things — a connection string, some default
image paths, a Hangfire login, and four Supabase tuning numbers. Everything a
person would call "the configuration" — M-Pesa credentials, SMS credentials, AI
keys, storage keys, branding, approval workflows, provisioning rules — lives in
**tables keyed by `EntityId`**, so it is per-lender and per-entity rather than
per-deployment.

That has one consequence worth stating plainly: **reading their config file tells
you almost nothing about how the live system is set up.** Any sweep that stops
there will conclude we are missing nothing, and be wrong.

---

## 2. Where their credentials actually live

The most reliable inventory of this is a list ServiceSuite maintains itself: the
tables its own AI assistant is forbidden from querying
(`Services/ServiceSuiteAIService.cs → AlwaysBlockedTables`, mirrored in
`Controllers/AiIntelligenceController.cs → _blockedTables`). Whoever wrote it had
to enumerate every table holding a secret, exhaustively, or leak one.

| Table | Database | Holds | Our equivalent |
|---|---|---|---|
| `StkParams` | **Transactions** | Daraja consumer key/secret, passkey, shortcode, callback URL | `OrgIntegration(MPESA_STK)`, AES-256-GCM |
| `africaisTalkingcredentials` | Serviceconnect | Africa's Talking username, API key, sender ID — **plaintext** | `OrgIntegration(SMS)` + `AFRICASTALKING_*` |
| `IntegrationSettings` | Serviceconnect | Anthropic / OpenAI / Gemini keys, Supabase URL + anon + **service-role** keys, Google Drive OAuth, Hangfire login, per-entity branding | split: env + vault + `Org` branding columns |
| `ApiClients` | Serviceconnect | Inbound API client ids and secrets | `SERVICESUITE_HOOK_SECRET`, `PLATFORM_ADMIN_SECRET` |
| `AuthenticatorKeys` | Serviceconnect | TOTP seeds for staff 2FA | `StaffUser.otpSecret` |
| `TrustonicCredentials` | Serviceconnect | Device-locking API key + tenant | none — we do not lock devices |
| `ZohoCliqCred` | Serviceconnect | Zoho Cliq OAuth client, tokens | none |
| `MarantechParams` | Serviceconnect | MDM vendor parameters | none |
| `ChiniseMdmParams` | Serviceconnect | Second MDM vendor parameters | none |

`StkParams` being in the **Transactions** database rather than Serviceconnect is
the detail that makes it easy to miss: a sweep of the main catalogue does not see
it, and the stored procedure that reads it (`sp_GetUssdStkParams`) is three-part
qualified for exactly that reason.

### The encryption is obfuscation, not protection

`Models/Decipher.cs` encrypts the M-Pesa credentials with **TripleDES in ECB
mode**, keyed on the **MD5 digest of a passphrase that is committed in the
source**:

```
koKRmH,HdaP5993fwfk33232!23#+*()__*&^^^&*STK
```

Three separate problems, and they compound:

- The key is in the repository, so anyone with the code and read access to the
  database has every lender's live Daraja credentials.
- **ECB mode** encrypts identical plaintext blocks to identical ciphertext
  blocks, so equal credentials across entities are visible without decrypting
  anything at all.
- **MD5 as a key-derivation function** has been unacceptable for this purpose for
  well over a decade.

This is reported here for two reasons. It is the mechanism our recovery script
reverses — so it is the reason the lost credentials are recoverable at all. And
it is a pattern that must not be repeated: this platform stores the same class of
secret in `OrgIntegration.configEnc` under **AES-256-GCM**, with the key held only
in the environment and never in the repository (`src/lib/vault/crypto.ts`).

**Africa's Talking credentials are not encrypted at all** — no `Decipher` call
goes anywhere near that table.

---

## 3. Behavioural settings — the parity table

These carry no secrets; they carry rules. One row per entity.

| Their table | What it configures | Ours | Status |
|---|---|---|---|
| `BorrowerSettings` | Onboarding fields, required documents, KYC rules | config namespace `borrower` → `/console/settings/borrowers` | ✅ |
| `RedisbursementSettings` | Approval workflow for re-disbursement | Workflow builder → `/console/workflows` | ✅ |
| `ManagedLoanSettings` | Approval workflow for managed loans | Workflow builder | ✅ |
| `LoanTopUpSettings` | Top-up eligibility and approval chain | Credit policy ladder → `/console/settings/credit` | ✅ |
| `SmsTemplate`, `SmsPlaceholders` | Per-entity SMS templates and merge fields | Comms templates → `/console/comms` | ✅ |
| `Preferences`, `SystemOptions` | Assorted toggles | config namespaces | ✅ |
| `IntegrationSettings` | AI, Supabase, Drive, Hangfire, branding | env + vault + `Org` columns | ✅ |
| **`ProvisionSettings`** | **Loan-loss provisioning bands** | — | ⚠️ **GAP** |
| **`LoanRestructureSettings`** | **Restructure rules and approval chain** | — | ⚠️ **GAP** |
| **`StkParams.BaseUrl`** | **Per-entity Daraja base URL (sandbox vs production)** | hardcoded to production | ⚠️ **GAP** |

### The three gaps, and what they mean

**Provisioning.** They compute loan-loss provisions in the database
(`sp_CalculateProvisions`, driven by `ProvisionSettings`) and expose them at
`/Provision`. We have no provisioning model at all. For a lender who reports to a
board or an auditor this is not cosmetic — it is the difference between a
portfolio figure and a *provisioned* portfolio figure. The Analytics Studio's
risk screen shows the ageing that provisioning would be computed from, so the
inputs exist; the policy and the posting do not.

**Restructures.** `sp_NewLoanRestructure` / `sp_ApproveLoanRestructure` /
`sp_RejectLoanRestructure` with their own settings table and approval chain. We
have top-ups and re-disbursement but no restructure path. On a book with
Micromart's arrears profile this is a live operational need, not a nice-to-have.

**Daraja base URL.** Their `StkParams` carries a per-entity `BaseUrl`, so one
entity can run against Safaricom's sandbox while another runs live. Ours pins the
production endpoint in code. Low urgency, trivial to add, and worth adding before
onboarding a lender who wants to test in sandbox first.

---

## 4. Stored procedures, functions, triggers

From the live-server extracts committed in the ServiceSuite repo
(`C:Tempdefs_54.txt`, `C:Tempdefs_198.txt`, `C:Tempmissing_sps_54.txt`):

| Kind | Count |
|---|---|
| Stored procedures | ~622 |
| Scalar / table functions | ~36 |
| Views | ~10 |
| **Triggers** | **0** |

430 distinct object names across the two servers. `scripts/recover-servicesuite-config.ts`
re-runs this inventory live, so it does not go stale.

**These are not to be ported, and that is a deliberate position.** Our business
logic lives in TypeScript, in version control, under test. Several hundred
uncovered T-SQL procedures is the thing we are replacing, not the thing we are
matching. What has to be true is that every *behaviour* one of them encodes
exists somewhere here — and the inventory is what makes that checkable rather
than a matter of opinion.

The extract also shows which of their objects are still moving; a procedure
modified last month is a part of their system still under active change, and
therefore a part where our parity claim needs re-checking rather than assuming.

---

## 5. The recovery plan

### Step 0 — the one variable that unlocks the rest

`SERVICESUITE_CONN_MICROMART`. Nothing below runs without it. It is a .NET-style
connection string:

```
Data Source=<host>,<port>;Initial Catalog=Serviceconnect;user id=<user>;password=<pw>;MultipleActiveResultSets=True
```

Three places it can come from, in order of preference:

1. **The ServiceSuite deployment's own `appsettings.json`**
   (`ConnectionStrings.connectionString`) on the server that is running right now.
2. Whoever administers that SQL Server.
3. Vercel's environment for this project, if the value was ever set there —
   `vercel env pull` recovers everything that was deployed, which for most of
   these variables is the fastest route of all and should be tried first.

Ideally it points at a **read-only, least-privilege** login with SELECT on
`Serviceconnect` and `Transactions` only. Our guard layer enforces read-only
regardless, but defence in depth starts at the credential.

### Step 1 — before anything else, try the vault key

If `VAULT_MASTER_KEY` is *nearly* right — a character dropped or doubled in a
copy-paste — it is recoverable in about a second, and recovering it saves
re-entering every credential this platform already holds:

```bash
DOTENV_CONFIG_PATH=.env npx tsx scripts/recover-vault-key.ts
```

AES-GCM authenticates its own ciphertext, so a wrong candidate cannot produce a
false positive. **Do this before rotating the key** — rotating destroys nothing on
disk but strands every stored credential permanently.

### Step 2 — pull back what the live system still holds

```bash
# report only, every value masked
DOTENV_CONFIG_PATH=.env npx tsx scripts/recover-servicesuite-config.ts --org micromart

# show the plaintext (do this in private, not on a shared screen)
DOTENV_CONFIG_PATH=.env npx tsx scripts/recover-servicesuite-config.ts --reveal

# write an env-shaped file instead of printing (mode 0600, refuses to overwrite)
DOTENV_CONFIG_PATH=.env npx tsx scripts/recover-servicesuite-config.ts --write .env.recovered
```

Recoverable this way:

- `MPESA_*` — consumer key, consumer secret, passkey, shortcode
- `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_SENDER_ID`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

**One thing must not be copied across: the callback URL.** Their `CallBackUrl`
points at *their* host. Copying it would send Safaricom's confirmations to
ServiceSuite instead of here. The script reports it as
`MPESA_CALLBACK_URL_THEIRS` for reference and never as ours.

### Step 3 — regenerate what only ever existed here

No copy of these exists on their server. Each has to be reissued:

| Variable | Action | Blast radius if changed |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Supabase dashboard | none |
| `VAULT_MASTER_KEY` | Rotate **only** if Step 1 fails | every stored credential must be re-entered |
| `NEXTAUTH_SECRET` | Regenerate | all sessions invalidated; **must match on every suite satellite** |
| `CRON_SECRET` | Regenerate | update the scheduler in the same change |
| `SERVICESUITE_HOOK_SECRET` | Regenerate | **must be changed on ServiceSuite's side too**, or their webhooks start failing silently |
| `PLATFORM_ADMIN_SECRET` | Regenerate | none |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Cloud console | Route Map stays dark until set |
| `GOOGLE_CLOUD_API_KEY`, `AWS_*` | Provider consoles | KYC falls back to simulation |
| `HUB_BILLING_URL`, `LMS_BILLING_SECRET` | Hub side | checkout unavailable |
| `ORIGINATION_SCORER_URL`, `SCORER_V1_URL` | Our own model endpoints | scoring falls back to simulation |
| Metropol keys | Awaiting production pair from Metropol | stays sandbox; go in the **vault**, not env |

### Step 4 — verify, do not assume

```bash
npm run test:sms          # SMS wallet — WILL SEND A REAL MESSAGE if credentials are live
npm run test:billing
npm run test:rls          # tenant isolation still enforced after a DATABASE_URL change
npm run db:rls:verify     # the cross-tenant attack suite
```

⚠️ Two standing rules from the blueprint are pre-applied in `.env` and must stay
that way on a laptop:

- `LMS_POSTING_ENABLED=false` — ServiceSuite posting is **disarmed**. Do not arm it
  locally without a reversible test borrower and a documented rollback.
- Leave `AFRICASTALKING_*` blank until you actually intend to send. A verify script
  that finds real credentials sends real SMS and spends real money.

---

## 6. Recommendations

1. **Do not adopt their credential-storage pattern.** Keep AES-256-GCM in the
   vault. If we ever need to write back into `StkParams` we will have to use
   their scheme to stay compatible — that is a reason to isolate it in one
   module (`src/lib/enterprise/servicesuite-config.ts`), which is what has been
   done, and not a reason to spread it.

2. **Raise the plaintext SMS keys with them.** `africaisTalkingcredentials` is
   readable by anyone with a SELECT on that database. It is a five-minute fix on
   their side and it is their exposure, not ours.

3. **Close the provisioning gap next.** It is the one parity gap with a regulatory
   and board-reporting edge, and the Analytics Studio's risk screen already
   computes the ageing it would be driven from.

4. **Pull `vercel env pull` first, every time.** Anything that was ever deployed
   is there, and it is faster than any of the above.
