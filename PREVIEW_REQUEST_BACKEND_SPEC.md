# Preview Request Backend Spec

## Purpose

This spec defines the backend work required to support the new preview-request flow on `theinsite.dev`.

The frontend already exists in the landing page and collects:

- current website URL
- business name
- contact email
- flavor / emphasis
- theme choice
- optional notes

The backend described here does **not** appear to live in this repository. This document is intended to be moved into the backend repo that owns the public intake flow and preview generation pipeline.

## Goal

Allow a visitor on `theinsite.dev` to:

1. submit their current site URL and preferences
2. trigger creation of a preview-generation job
3. receive a preview link by email when ready
4. keep that preview live for 24 hours
5. receive reminder and deletion-warning emails
6. optionally extend preview lifetime by 7 days

## Existing Context

From this repo:

- The landing page is static and deployed from `company-page`.
- The current internal generation path is referenced from `theinsite-admin`.
- `theinsite-admin` currently talks to an external renovation API / CMS, not code in this repo.
- The current admin generation payload shape is approximately:

```json
{
  "url": "https://example.com",
  "slug": "example",
  "name": "Example Business",
  "allowInsecureTls": true,
  "acceptHttpErrorHtml": false,
  "deployVercel": true
}
```

The new public flow should preserve compatibility with that model where possible.

## Proposed Ownership

The external backend service should own:

- public intake endpoint
- persistence of preview requests
- mapping intake requests to generation jobs
- preview lifecycle state
- scheduled email delivery
- preview expiration
- preview extension

The static landing page should only:

- collect inputs
- POST to the public intake endpoint
- show success / failure states

## Public API

### 1. Create preview request

`POST /api/preview-requests`

Purpose:

- Accept public landing-page submissions.
- Validate the request.
- Persist a preview-request record.
- Create or link a lead/business record if needed.
- Trigger generation asynchronously.

Request body:

```json
{
  "url": "https://example.com",
  "slug": "example",
  "name": "Example Business",
  "contact_email": "owner@example.com",
  "preferences": {
    "flavor": "trust-first",
    "theme_choice": "logo-colors",
    "theme_mode": "logo-colors"
  },
  "notes": "Optional freeform context from the user.",
  "source": "theinsite-dev-landing"
}
```

Field notes:

- `url`: required, absolute URL
- `slug`: optional from frontend, backend should normalize or regenerate
- `name`: required
- `contact_email`: required
- `preferences.flavor`: required enum
- `preferences.theme_choice`: required enum
- `preferences.theme_mode`: required enum, currently either `logo-colors` or `manual`
- `notes`: optional
- `source`: optional but recommended for attribution / analytics

Response:

```json
{
  "request_id": "pr_123",
  "status": "accepted",
  "lead_id": "lead_456",
  "message": "Preview request accepted."
}
```

Failure examples:

- `400` invalid payload
- `409` duplicate active request for same domain/email
- `429` rate limited
- `500` unexpected backend failure

### 2. Preview request status

`GET /api/preview-requests/:request_id`

Purpose:

- Support debugging, admin inspection, or future client polling.

Response:

```json
{
  "request_id": "pr_123",
  "status": "queued",
  "lead_id": "lead_456",
  "preview_url": null,
  "expires_at": null,
  "last_error": null
}
```

Suggested status values:

- `accepted`
- `queued`
- `generating`
- `ready`
- `email_sent`
- `expired`
- `deleted`
- `extended`
- `failed`

### 3. Extend preview lifetime

`POST /api/preview-requests/:request_id/extend`

Purpose:

- Extend preview lifetime by 7 days.

Request body:

```json
{
  "extension_days": 7,
  "reason": "buy-us-a-coffee"
}
```

Response:

```json
{
  "request_id": "pr_123",
  "status": "extended",
  "expires_at": "2026-09-02T12:00:00.000Z"
}
```

## Validation Rules

### URL

- must be absolute
- must use `http` or `https`
- should be normalized before storage
- backend should derive canonical hostname

### Email

- must be syntactically valid
- should be normalized to lowercase

### Name

- required
- trim whitespace
- max length recommended: 160 chars

### Flavor enum

Current frontend values:

- `trust-first`
- `premium`
- `friendly`
- `conversion`

### Theme enum

Current frontend values:

- `logo-colors`
- `light-editorial`
- `dark-luxury`
- `bold-modern`

### Anti-abuse

At minimum:

- per-IP rate limiting
- per-domain cooldown window
- per-email cooldown window
- bot protection or honeypot
- structured request logging

## Persistence Model

Recommended new table or collection: `preview_requests`

Suggested fields:

- `id`
- `created_at`
- `updated_at`
- `source`
- `status`
- `website_url`
- `website_hostname`
- `slug`
- `business_name`
- `contact_email`
- `flavor`
- `theme_choice`
- `theme_mode`
- `notes`
- `lead_id`
- `generation_job_id`
- `preview_url`
- `preview_ready_at`
- `expires_at`
- `extended_at`
- `extension_count`
- `deleted_at`
- `failure_reason`
- `request_ip`
- `user_agent`

Optional related table: `preview_request_events`

Suggested use:

- audit trail
- email events
- lifecycle state changes
- retries / failures

## Lead Creation / Linking

The backend must decide whether a preview request:

1. creates a brand new lead/business record
2. links to an existing lead/business record by normalized domain
3. creates a new request against an existing lead

Recommended behavior:

- look up by canonical hostname first
- if an active lead already exists, attach a new preview request to it
- if no lead exists, create one

Minimum fields needed to create a lead:

- `business_name`
- `website_url`
- `contact_email`

The backend may also store preview preferences either:

- directly on `preview_requests`
- on a lead metadata/profile field
- or both

## Generation Trigger

The backend should map the public preview request into the existing generation backend contract.

Internal generation payload target:

```json
{
  "url": "https://example.com",
  "slug": "example",
  "name": "Example Business",
  "allowInsecureTls": true,
  "acceptHttpErrorHtml": false,
  "deployVercel": true
}
```

Additional preview-request metadata should remain associated with the request record:

```json
{
  "preferences": {
    "flavor": "trust-first",
    "theme_choice": "logo-colors",
    "theme_mode": "logo-colors"
  },
  "contact_email": "owner@example.com",
  "notes": "Optional notes"
}
```

Important:

- `name` maps directly from frontend `business name`
- `theme` is **not** currently known to be a first-class field in the existing generation contract
- if the generation engine cannot yet consume `flavor` or `theme_choice`, store them now and ignore them safely until supported

## Theme / Flavor Integration

This should be implemented in two phases.

### Phase 1

Persist the new fields without changing generation behavior.

Required:

- store `flavor`
- store `theme_choice`
- store `theme_mode`
- expose them in internal admin/debug views

Generation may ignore these values initially.

### Phase 2

Use those values in the generation system.

Possible mappings:

- `flavor` influences copy tone, hierarchy, CTA emphasis, or layout selection
- `theme_choice = logo-colors` triggers palette extraction from logo or existing brand assets
- manual theme choices map to predefined visual presets

## Logo-Color Behavior

Frontend copy now says:

`Simply use my logo colors`

Backend interpretation should be:

- do not ask the user for explicit color hex values
- attempt to derive palette from existing site logo or brand assets
- if extraction fails, fall back to default theme logic

Recommended behavior:

1. detect logo from scraped site or existing image extraction
2. extract primary / accent palette
3. validate contrast and usability
4. if invalid, use fallback preset and log the failure reason

This should not block preview generation.

## Email Lifecycle

Required email sequence:

### 1. Preview ready

Trigger:

- generation completed successfully

Contents:

- preview URL
- expiry time
- main CTA: `Let's go live`

### 2. Reminder

Trigger:

- some time before expiry

Suggested send time:

- 12 hours after ready, or
- 6 hours before expiry

Contents:

- preview URL
- expiry reminder
- CTA: `Let's go live`

### 3. Deletion warning

Trigger:

- shortly before deletion

Suggested send time:

- 1 hour before expiry

Contents:

- warning that preview will be removed
- extension option
- CTA: `Let's go live`

### 4. Extension confirmation

Trigger:

- successful extension

Contents:

- updated expiry time
- preview URL
- CTA: `Let's go live`

## Preview Lifetime

Baseline rule:

- preview is live for 24 hours from ready time

Required stored timestamps:

- `preview_ready_at`
- `expires_at`

Lifecycle behavior:

1. mark preview `ready`
2. send ready email
3. schedule reminder
4. schedule deletion warning
5. at expiry, remove or disable preview
6. mark request `expired` or `deleted`

## Deletion / Expiry Behavior

Need a concrete product decision:

### Option A: hard delete

- remove preview deployment entirely
- preview URL becomes unavailable

### Option B: soft disable

- keep deployment assets
- gate access behind expired state or “request extension” page

Recommendation:

- prefer soft disable first if operationally simple
- hard delete later only if cost/storage requires it

## Scheduling / Jobs

Backend will need background job support for:

- async generation trigger
- preview-ready email
- reminder email
- deletion-warning email
- expiry action
- extension processing

Any queue / scheduler is acceptable as long as jobs are idempotent.

## Idempotency

The system should be safe against duplicate submissions and retries.

Recommended protections:

- idempotency key derived from normalized hostname + contact email + recent time window
- do not create duplicate active preview requests for the same domain/email pair
- retry-safe generation trigger
- retry-safe email jobs

## Observability

Required logging:

- intake accepted
- validation failure
- lead linked/created
- generation queued
- generation failed
- preview ready
- each email send attempt
- expiry execution
- extension request

Recommended metrics:

- intake count
- intake-to-preview-ready conversion
- preview-ready-to-live conversion
- duplicate request rate
- theme extraction success rate
- email send success/failure rate

## Error Handling

User-facing public endpoint should return generic safe messages.

Internally log structured causes:

- invalid URL
- duplicate active request
- lead creation failure
- generation API unavailable
- generation timeout
- email provider failure
- preview deployment failure

If generation fails:

- mark request `failed`
- preserve failure reason
- do not send preview-ready email

## Security

Because this is a public endpoint:

- add rate limiting
- validate all input strictly
- log abuse attempts
- avoid exposing internal generation endpoints directly to the browser
- keep generation secrets only on backend

The frontend should never call internal admin-only endpoints directly.

## Abuse Protection

This is a required part of the first release, not a future enhancement.

The preview-request endpoint is expensive because each accepted request may create:

- a stored lead/request record
- a generation job
- one or more emails
- a temporary preview deployment

That means the intake endpoint must reject low-quality, automated, or repeated requests before they reach generation.

### Required controls

#### 1. Rate limiting

Apply rate limits at multiple levels:

- per IP
- per normalized hostname/domain
- per contact email

Suggested first-pass limits:

- max 5 requests per IP per hour
- max 2 active preview requests per domain per 24 hours
- max 2 active preview requests per email per 24 hours

The exact numbers can change, but all three dimensions should exist.

#### 2. Active-request deduplication

Do not allow repeated requests to create unlimited active previews.

Recommended rule:

- if a request already exists for the same normalized domain and contact email, and its status is one of:
  - `accepted`
  - `queued`
  - `generating`
  - `ready`
  - `email_sent`
  - `extended`
- then reject the new request with `409 Conflict` or return the existing active request

This should happen before any generation trigger is created.

#### 3. Bot friction

The public form should not rely on frontend-only validation.

Backend should support at least one of:

- CAPTCHA / Turnstile / equivalent challenge
- invisible risk scoring
- signed anti-bot token validation

Recommendation:

- use Cloudflare Turnstile or an equivalent low-friction challenge on the intake form
- verify the token server-side before accepting the request

#### 4. Honeypot support

Add a hidden form field on the frontend and reject submissions where it is filled.

This is weak on its own, but cheap and useful as one layer.

#### 5. URL quality checks

Reject clearly abusive or low-value targets before they hit generation:

- malformed URLs
- localhost / private-network targets
- unsupported schemes
- obviously fake domains
- blocked internal/admin domains

Optional but recommended:

- maintain a denylist of abusive domains and email patterns

#### 6. Email quality checks

At minimum:

- normalize email to lowercase
- reject disposable/temporary email providers if product allows
- reject malformed or obviously synthetic addresses

If disposable emails are allowed, still score and log them.

#### 7. Cost gate before generation

Do not trigger generation immediately just because intake validation passed.

Insert a backend gate between intake and generation:

1. request accepted
2. abuse checks passed
3. duplicate/active-request checks passed
4. optional risk score below threshold
5. only then queue generation

This gate may be synchronous or asynchronous, but it must exist.

#### 8. Queue isolation

Public preview requests should not be able to starve internal/admin generation work.

Recommended:

- separate queue for public preview jobs
- concurrency limits for public jobs
- priority lower than internal/admin jobs

#### 9. Email-send protection

Do not let the same actor trigger repeated email sends.

Recommended rules:

- only one preview-ready email per request status transition
- cooldown before resending
- no repeated reminder scheduling for duplicate requests

#### 10. Signed action links

Any extension or “go live” action coming from email should use:

- signed tokens
- short-lived verification links
- one-time or replay-safe semantics where appropriate

Do not expose raw internal IDs without signature validation.

### Risk scoring

Recommended but not strictly required for V1:

Compute a lightweight abuse/risk score from:

- IP reputation
- repeated submissions from same IP/email/domain
- disposable email usage
- suspicious user-agent
- mismatched geography if available
- repeated failures on the same hostname
- bot-challenge result

Then:

- auto-accept low-risk requests
- hold medium-risk requests for manual review or delayed processing
- auto-reject high-risk requests

### Manual review state

Add an optional status:

- `needs_review`

Use it when:

- abuse score is inconclusive
- duplicate logic is ambiguous
- domain looks real but request pattern is suspicious

This protects the system without hard-rejecting every uncertain request.

### Logging and audit

For every rejected or suspicious request, log:

- normalized domain
- normalized email
- IP
- user-agent
- rejection reason
- risk score if present
- whether bot verification passed

This data should be queryable for tuning thresholds later.

### Recommended first-release minimum

Abuse protection that should be considered mandatory for launch:

- IP/email/domain rate limiting
- active-request deduplication
- server-side bot verification
- honeypot support
- URL validation including localhost/private-network rejection
- public-job concurrency limits
- structured abuse logging

## Suggested Delivery Phases

### Phase 1: Intake + persistence

- build `POST /api/preview-requests`
- validate input
- store preview request
- create/link lead
- return accepted response

### Phase 2: Generation bridge

- trigger existing generation backend
- persist job IDs and status
- store preview URL and ready timestamp

### Phase 3: Email lifecycle

- send preview-ready email
- send reminder
- send deletion warning
- support extension email

### Phase 4: Theme / flavor consumption

- make generation system consume `flavor`
- make `logo-colors` derive palette from logo automatically
- make manual theme choices map to visual presets

## Frontend Contract Notes

The current frontend in `company-page/index.html` is already shaped around this payload:

```json
{
  "url": "https://example.com",
  "slug": "example",
  "name": "Example Business",
  "contact_email": "owner@example.com",
  "preferences": {
    "flavor": "trust-first",
    "theme_choice": "logo-colors",
    "theme_mode": "logo-colors"
  },
  "notes": null
}
```

Once the public backend endpoint exists, the frontend can switch from local staging to a real `fetch()` call with minimal change.

## Open Questions

These need resolution in the backend repo:

1. Which service owns the public intake endpoint?
2. What database/schema should hold `preview_requests`?
3. Is there already an existing lead record model in that backend?
4. Does the generation engine already support any theme override fields?
5. Can preview deployments be soft-disabled, or only deleted?
6. What email system sends the lifecycle emails?
7. What scheduler/queue is available for reminder and expiry jobs?
8. Should extension require payment, token validation, or just a signed email link?

## Minimum Acceptable First Release

If speed matters, the smallest useful backend release is:

- public intake endpoint
- validation + rate limiting
- persist preview request
- create/link lead
- trigger generation
- preview-ready email
- 24-hour expiry timestamp

Everything else can layer on afterward.
