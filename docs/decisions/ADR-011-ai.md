# ADR-011: AI template generation and vocatives (Phase 1, slice 11)

- Status: accepted
- Date: 2026-11-04
- Context: spec §0.5 (vocatives), §15 (AI responsibilities, prompt, validation, vocatives, model
  and cost), §17 (no client access to the AI log), §18 (`ai_generations`, `name_vocatives`),
  §42 rule 9 (no customer data to AI), §40.11

## Decisions

1. **Provider wrapper.**
   - Everything above `lib/ai/model.ts` talks to a `TextModel` with one method, `complete`.
   - There are two implementations:
     - the mock: library templates, no network, and the default everywhere outside
       production;
     - a Vercel AI SDK (`ai` v7) adapter using `generateText` with `instructions` and
       `prompt`, temperature 0.7 (0 for vocatives), one SDK retry and a 30 s timeout.
   - `lib/ai/provider.ts` picks the model from `AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY`.
     Real providers require both the model and the key (`lib/env/schema.ts`).
     `DATA_SOURCE=demo` always uses the mock.
   - No real key was configured or used in this slice. Before production, pick a provider
     with EU processing or zero data retention and list it as a sub-processor (spec §15).
2. **Prompt v1** (`lib/ai/prompts/campaign-template.v1.ts`):
   - It follows the spec skeleton. Preset goals, categories and month ranges are fixed
     English context; the shop name and city are the only company data.
   - Rewrite actions (kratší, přátelštější, profesionálnější, znovu) reuse the system
     prompt with a tone and ask for one variant.
   - Operator text sent for a rewrite is masked first: e-mails become `[e-mail]` and
     digit runs become `[číslo]`.
   - Any wording change gets a new file and version, so log rows stay comparable.
3. **Validation and retry.**
   - An answer is accepted only if it holds valid JSON with 1–3 variants and every
     variant passes `validateTemplate`.
   - Otherwise it is regenerated once, with the rejection reasons appended to the
     prompt. A second failure returns `ai_invalid_output`; a provider error returns
     `ai_unavailable`. The operator can always write the message by hand.
   - The length check now renders with the longest greeting ("Dobrý den, paní
     Procházková,"), so templates also fit when vocatives are on. All library
     templates still pass.
4. **`ai_generations`.**
   - Every call is logged, including failed ones: prompt version, model, input
     (company-level context only), output with attempts and rejection reasons, and
     tokens.
   - `chosen_index` starts at 0 (the builder applies variant 1) and is updated when the
     operator picks another variant.
   - Generations made while creating a campaign are linked to it on save; on the edit
     page they carry the `campaign_id` at once.
   - There is no client access. The operator may read the log; the server writes it
     with the service role and always sets `company_id`.
   - Composite foreign key to campaigns, `on delete set null (campaign_id)`.
5. **Vocatives.**
   - **Rules** (`lib/domain/messaging/vocative.ts`) cover these patterns:

     | Pattern         | Examples          |
     | --------------- | ----------------- |
     | -ová, -á        | Nováková, Černá   |
     | -ý              | Černý             |
     | masculine -a    | Svoboda → Svobodo |
     | -ek             | Hájek → Hájku     |
     | velars          | Novák → Nováku    |
     | soft consonants | Beneš → Beneši    |
     | hard consonants | Zeman → Zemane    |

     The irregular -ec, -el, consonant + r and gender-neutral -í endings get a
     low-confidence suggestion.

   - **AI batch:** the rest goes to an AI batch of up to 100 surnames, sending surnames
     only (spec §15 allows this). AI answers must share the surname's stem.
     Self-reported confidence is capped at 0.85, so every AI suggestion is reviewed.
     Surnames the model cannot answer get a placeholder row with confidence 0, so they
     appear for review and are not sent again.
   - **When a vocative is used:** the gender must be known, and the vocative must be
     either reviewed or confident (≥ 0.90). Otherwise the greeting stays "Dobrý den,".
   - **Personalised greetings** are a per-company setting, `personalized_greeting`, off by
     default. It lives in `companies.settings` rather than a `feature_flags` table, which
     no other feature needs yet.
   - **Job:** `vocatives/refresh.requested` runs inline locally and in Inngest in
     production. The operator starts it from the review screen. It never overwrites an
     existing row.
   - **Review screen:** `/admin/companies/[id]/vocatives` shows the counts, the uncertain
     entries with an editable form, gender and a live greeting, and the recently
     approved entries. An operator edit sets `source='operator'` and confidence 1.
   - **Access:** shop users may read their company's vocatives (needed for previews; a
     surname's greeting form is not contact data). Only the operator writes them.
6. **Renderer.** `{{osloveni}}` renders the recipient's approved greeting when the shop
   turned greetings on, otherwise "Dobrý den,". Builder and detail previews use the
   same lookup, so the owner approves exactly what will be sent.
7. **Audit events:** `vocatives.refreshed` and `vocative.reviewed`.

## Deferred

- The send job (slice 12) renders with the same greeting lookup at enrollment time.
- An "offer" field in the builder: the prompt and validator already support it.
- Automatic vocative refresh after each import commit; for now the operator starts it.
