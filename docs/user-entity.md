# The user entity

**Status: the schema is on main and proven by `root:rls-verify`. The workflows around it are
agreed but unbuilt.** This page covers who owns which record and what happens at signup, payment
and auth. The package layout and the verification seam are in
[the auth proposal](auth-proposal.md), and the screens these workflows put in front of a person are
[The auth screens](auth-screens.md). This page does not repeat either.

## Who owns what

| Owner     | Holds                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| WorkOS    | user, email, name, organization, membership, roles, permissions              |
| Stripe    | customer, subscription, prices, invoices, and entitlement truth              |
| This repo | `accounts` keyed by organization, `profiles` keyed by user, all product data |

The rule that keeps the split honest: **a column that can go stale against the vendor does not
belong in our schema.** No email, no display name, no avatar, no subscription status.

## Billing is organization scoped, and that was not our choice

A Stripe customer id is associated with a **WorkOS organization**. The entitlements on that
organization's subscription then arrive in the access token of every member as an `entitlements`
claim, and WorkOS pushes the organization's seat count back to Stripe. There is no user level
billing in this model.

So the paying entity is the organization, and per-seat pricing is expressed as an organization of
one. Every user gets a personal organization at signup whether or not they ever invite anyone. It
costs nothing and it means adding a second person later is a membership insert rather than a
migration of the table everything else keys off.

### A team fee and a per-seat price can coexist

One Stripe subscription carries several prices, so a flat recurring price for the team and a
licensed per-seat price sit on the same subscription against the organization's Stripe customer.

WorkOS exposes the two halves as independent switches, `stripeEntitlementsEnabled` and
`stripeSeatSyncEnabled`. Seat sync pushes the organization's member count into Stripe as the
quantity, which is what keeps the per-seat line correct without a reconciliation job of our own.

**The `entitlements` claim carries feature names, not quantities.** The token says `cubicell:pro`.
It does not say how many seats. Anything needing the seat number reads WorkOS or Stripe off the
request path. Gates are therefore written as "does this organization have this feature" and never
as "how many of X does it have".

**Entitlements must be namespaced per product from the first Stripe product created.** Stripe
Connect is configured per WorkOS environment, and both products share one environment because that
is what gives them a shared user pool. One organization therefore has one Stripe customer carrying
one entitlement set spanning every product. Selling them separately means names like `cubicell:pro`
and `audioface:pro`, with each app reading only its own prefix. Retrofitting a naming scheme across
live subscriptions is unpleasant, which is why it is written down before the first product exists.

## The workflows

### Signup

1. Continue with Google on the product domain.
2. WorkOS authorize, Google consent, WorkOS callback, then the app's own callback with a code.
3. The app exchanges the code for an access token and a refresh token.
4. The token carries `sub`. It carries `org_id` only if the user belongs to an organization, and a
   new user does not.
5. The app creates the organization and adds the user to it, automatically, with no screen.
6. Refresh. The token now carries `org_id`.
7. In the transaction that verified that token, insert the `accounts` and `profiles` rows.

Step 5 is the one that surprises people: social signup hands you an identity, not a tenant. It is
**permanently application code**, because WorkOS has no setting that creates an organization for a
new user. Measured, see open question 1.

The organization is named from the profile when one exists and from the full email address
otherwise, it is created with **no domains attached**, and creation is keyed on the WorkOS user id
so a retry cannot produce two. The reasoning behind all three rules, and the screens either side of
this step, are [The auth screens](auth-screens.md).

### Payment

8. Stripe Checkout for the organization creates the Stripe customer.
9. The Stripe customer id is written onto the WorkOS organization.
10. The next token refresh carries `entitlements`.

### Auth, steady state

11. The access token lives 300 seconds and the refresh token rotates silently.
12. `verify(token)` returns a `Principal`.
13. `withPrincipal()` opens the transaction, sets the role and the claims, and RLS does the rest.
14. Entitlement checks read the claim. No database lookup and no Stripe call on the request path.

## What is deliberately absent

**No billing table.** No subscriptions, no webhook, no reconciliation job. Entitlements arrive as a
signed claim with a staleness ceiling of 300 seconds. Subscription state is the most staleness prone
data in any product, so the one place it must not be copied to is our database.

**No memberships table.** WorkOS owns membership, and it proves membership by putting `org_id` in a
signed token. Duplicating that here would create a second answer to the same question.

**No foreign key from `profiles` to `accounts`.** One person may hold membership in several
accounts, so a profile outlives any single one of them. This is the only place the team story
touches the schema today, and it costs nothing to leave open.

**No shared identity service.** A single customer record across products needs one database keyed on
a stable id, not a broker in the browser redirect path. Applications in one WorkOS environment share
a user pool, so `sub` is already identical across products. They also share a session on the
environment-level AuthKit domain: a sign-in to one application yields a code for a second
application in the same browser, with no credential prompt. That is proven, see open question 2.
littleorgans does not need to be an identity broker. Each product's redirect chain still ends at
its own callback. Both apps reach the same rows through `packages/db`. A service in front of that
earns its place when the apps stop sharing a codebase or a language, or when something outside this
repo needs access, and extracting one later is not a rewrite because it would import the same
package.

## The schema

`db/schema.sql` holds `accounts` and `profiles`. Both are baseline, not exemplars.

```sql
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_org_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Thin on purpose. `profiles` gains columns as the product needs them, starting with the selected
theme, since a user-edited theme is a row.

## Neither artifact records the security. Both exit 0 anyway

This is the important part of this page.

**Atlas Community v1.3.0 drops functions, `ENABLE ROW LEVEL SECURITY`, policies, roles and grants
from a diff, silently.** Written into `db/schema.sql`, they produce a migration containing only the
tables, with no warning and exit code 0. Verified directly against v1.3.0.

**`drizzle-kit pull` drops the `USING` expression from SELECT policies.** The generated artifact
renders `accounts_select` with no `using` key at all, which reads as though the policy restricts
nothing. It restricts rows.

So the two files a reviewer would naturally read both misrepresent the security model, in opposite
directions, without failing. That is the exact failure shape `decisions.md` already records twice
for lint and for coverage.

**Everything Atlas cannot model lives in a hand-written migration**,
`db/migrations/20260822081700_identity.sql`. Atlas leaves it alone on re-diff: with the dev URL
pinned to `search_path=public`, neither the `app` schema nor the policies appear on either side of
the comparison, so no drift is planned and `atlas migrate lint` reports the version ok. Both were
verified rather than assumed.

**`root:rls-verify` is the authority.** It applies the migrations to a real Postgres and observes
behaviour, because no artifact can be reviewed for this. Six assertions:

- accounts are scoped to the org in the claims
- profiles are scoped to the subject in the claims
- absent claims reveal nothing rather than everything
- an account cannot be created for another org
- claims do not survive the transaction that set them
- every table in `public` has row level security enabled and forced

The last one is the one that will earn its keep: a table added to `db/schema.sql` without a matching
policy migration is readable by every tenant, and nothing else in the repo would notice.

Each assertion was proven to fail. Removing `FORCE` fails the sixth. Weakening `accounts_select` to
`USING (true)` fails three. Removing the `nullif` guard fails two with `22P02`.

### Three details that are load-bearing

**`FORCE ROW LEVEL SECURITY`, not just `ENABLE`.** Without it the table owner bypasses every policy,
so a connection using the migration owner reads every tenant. Enabled alone looks identical in every
artifact.

**`nullif(current_setting(...), '')`.** At COMMIT a transaction-local GUC reverts to empty string
rather than to unset, so a bare `::jsonb` cast raises `22P02` on the next request to borrow the
connection. This was found by the gate, not by review, and the snippet in the auth proposal carried
the same defect.

**`SET search_path = pg_catalog` on both helpers.** They decide row visibility, so they do not
inherit a caller's search path.

## Roles

The migration creates `authenticated` only if it is absent, so it applies unchanged to a bare
Postgres and to a Supabase project where the role already exists. That resolves open question 5 in
the auth proposal in favour of reusing the name: matching Supabase costs nothing and keeps one
migration working on both.

The application connects as a login role that can `SET LOCAL ROLE authenticated` and never as the
table owner.

## Open questions

1. ~~**Does a brand new social user arrive without `org_id`, and can WorkOS create the organization
   itself?**~~ **Answered: yes, and no.** A token issued to a user with no organization carries
   `iss`, `sub`, `sid`, `jti`, `auth_time`, `client_id`, `iat` and `exp` and nothing else, measured
   in staging. No WorkOS setting creates an organization for a new user, and the API offers no such
   hook. Step 5 is application code permanently, and it runs unattended inside the callback. The
   three rules it must follow are in [The auth screens](auth-screens.md).
2. ~~**Does silent SSO work between two AuthKit applications in one environment?**~~
   **Answered: yes, within one environment.** Proven 2026-08-22 in staging. Two AuthKit
   applications, app A `client_01M0JSGENAGWJCN0R7JME8JWGM` and a temporary app B. Signed in to A
   with an email sign-in code. Then requested B's authorize URL in the same browser session. The
   redirect chain was:

   1. `api.workos.com/user_management/authorize?client_id=<B>`
   2. `shining-turtle-76-staging.authkit.app/bootstrap?client_id=<B>`
   3. `shining-turtle-76-staging.authkit.app/?client_id=<B>`
   4. `shining-turtle-76-staging.authkit.app/api/refresh-token?...&path=sign-in`
   5. `localhost:5174/callback?code=...`

   No sign-in form and no credential prompt. Step 4 is the mechanism: AuthKit reuses the session
   on the shared environment-level domain and mints a fresh code for a different `client_id`.

   Proven within one environment. Staging and production are separate AuthKit domains and will not
   share a session. `maxSessionTime` and `inactivityTimeout` are per application, so two apps can
   disagree about when the shared session expired. That disagreement was not tested.

3. **Which columns does `profiles` actually need?** It is a key and a timestamp today.
4. **Does the custom auth domain get taken, and under which name?** It is environment level, so it
   serves both products and wants to be neutral. Enabling it regenerates the redirect URI for every
   social provider, each of which must then be re-registered, so it is cheaper before providers are
   wired than after.
