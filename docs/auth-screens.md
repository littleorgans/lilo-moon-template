# The auth screens

**Status: agreed and unbuilt.** This is the screen inventory for #16. Nothing here exists in
`apps/web` yet. Every screen is named by the `Principal` that produces it, so the contract and the
UI cannot drift apart without one of them being obviously wrong.

The record model, the schema and the workflows are [The user entity](user-entity.md). The package
layout and the verification seam are [the auth proposal](auth-proposal.md). This page does not
repeat either.

## Why the inventory exists

`Principal` has a nullable `orgId` and three lists, and `AuthFailure` has six values. That is a
state space, and a state space with no drawing gets discovered one production incident at a time.
Drawing every state before building found four decisions that neither the docs nor the packages
had taken. They are recorded below where each one lands.

The rule this page follows: **one screen per state a token can put a person in.** A state with no
screen is a decision, not an omission, and it is written down as one.

## First run

Four screens. This is the workflow in [The user entity](user-entity.md) made concrete, so the
numbering matches a real sequence rather than decorating one.

### 1. Signed out

Route `/`. No token exists.

Continue with Google. Both Google and an emailed sign-in code work against WorkOS staging, and
**only Google is wired**: the email path needs its own two-step form, which is a separate piece of
work rather than a variation on this one. Passkeys are enabled and MFA is optional, so both appear
on the AuthKit side of the flow rather than here.

### 2. Callback

Route `/callback`. **Built as a server route that redirects on success, which is a change from the
decision recorded here, and the reason is worth keeping.**

The screen was chosen to avoid a blank tab during a slow exchange. That risk turned out not to
exist. The exchange needs the API key, so it must happen on the server, and while it runs the
browser is still showing the provider's page waiting on our response. There is no blank tab to
prevent. Rendering a spinner would mean returning HTML first and exchanging afterwards, which needs
a second round trip to do worse.

So success is a 302 to `/app` and nothing is painted. **Failure does render**, and that is where a
page earns its place: a redirect cannot explain why sign-in stopped.

Four things happen here, in order, and all of them are server side:

1. **Compare the returned `state` against the value stored when the flow started.** A mismatch
   ends the request. Nothing else in the callback is safe until this passes.
2. Exchange the code for an access token and a refresh token.
3. Verify the access token. `orgId` is `null`, which is normal and not an error.
4. **Create the organization, add the user to it, and refresh.** See below.

Step 1 is the one that is easy to skip, because skipping it changes nothing visible: sign-in still
works. What it removes is the callback's only way to tell its own redirect from one an attacker
handed the browser. `getAuthorizationUrl` therefore takes `state` as a required argument and
refuses an empty one, so the unsafe version does not type-check. Verified 2026-08-24 that the
provider returns the value unchanged, wrapped in its own signed envelope alongside the redirect
URI, so it is genuinely ours to compare.

The Principal at step 3:

```
userId        "user_01HBEQ..."
orgId         null
roles         []
permissions   []
entitlements  []
```

### The organization is created here, automatically

**Decided: no naming screen.** WorkOS has no setting that creates an organization for a new user,
so the application does it. Asking the person to name a workspace adds a screen and a route to
signup for a value that is invisible until somebody is invited. The org-of-one is the common case
and it does not deserve a form.

Three rules, each of which has already cost us something once:

**Name it from the profile, and fall back to the full email address.** Google supplies a name, so
`Stuart's workspace` is available on that path. The email-code path has no name at all, so the
fallback is required. Use the whole address rather than the local part: the org name is what
appears in a workspace switcher, and local parts collide constantly.

**Attach no domains.** An organization that owns a verified domain captures everybody whose email
carries it, and domain-based SSO routing runs before password auth. We hit this already: a probe
with an `@example.com` address was routed to SAML because a seeded organization owned that domain.
A personal org claiming `alphab.io` would pull the next colleague into it. A personal org claiming
`gmail.com` would be far worse.

**Key creation on the WorkOS user id.** `provisionOrganization` takes an `idempotencyKey`. A
callback that fires twice, or two tabs finishing at once, otherwise gives one person two
organizations and no way to tell which is real.

After the refresh the token carries `org_id`, and the `accounts` and `profiles` rows are inserted
by `runScoped` in the first request that follows.

### 3. Signed in, no entitlements

Route `/app`. A tenant exists and nobody has paid.

```
orgId         "org_01M0JS..."
roles         ["owner"]
permissions   ["billing:manage"]
entitlements  []
```

This is the state most accounts stay in permanently, so it is the one worth designing carefully.

**What free allows is not decided here, on purpose.** The template ships the mechanism, an
entitlement check that gates a feature and renders an upgrade prompt. The policy, which feature and
which limit, arrives with the first real product. A baseline that invents a limit is inventing a
product.

### 4. Signed in, entitled

Route `/app`, same route. One claim is the entire difference.

```
entitlements  ["cubicell:pro"]
```

The prefix is load bearing. Both products share one WorkOS environment, which is what gives them a
shared user pool, so one organization carries one entitlement set spanning every product. The
namespacing has to exist before the first Stripe product does.

## Steady state

Not a sequence. Three surfaces reachable in any order, each holding a decision the schema has
already taken.

**People.** Membership lives in WorkOS and is proven by `org_id` in a signed token. There is
deliberately no memberships table, so this surface reads the provider and never our database.

**Billing.** Organization scoped, because a Stripe customer id attaches to a WorkOS organization.
There is no billing table and no reconciliation job.

**Account.** The only surface that writes to `profiles`, starting with the selected theme. Email and
display name are absent on purpose: a column that can go stale against the provider does not belong
in our schema.

## Failure

`AuthFailure` has six values. A person holding a laptop can act on roughly one distinction.
Collapsing them is the design decision; naming which ones collapse is what stops it becoming an
accident.

| Reason      | Meaning                                             | What the person sees        |
| ----------- | --------------------------------------------------- | --------------------------- |
| `expired`   | Routine. The access token lives 300 seconds.        | **Nothing.** Refresh, retry |
| `signature` | Not signed by the key we trust.                     | Session ended               |
| `issuer`    | Real key, wrong environment.                        | Session ended               |
| `audience`  | Minted for a different application.                 | Session ended               |
| `malformed` | Not a JWT at all.                                   | Session ended               |
| `claims`    | **Our problem.** Signature valid, shape unexpected. | A different message, logged |

**Session ended names no reason.** A token failing its signature, issuer or audience may be an
attack, and telling the holder which check failed tells an attacker which knob to turn.

**`claims` is the only reason that earns its own screen.** The signature checked out, so the
provider really did issue the token, and then the shape was wrong. That is an outage on our side.
**Decided: inform the person and log it.** Sending them to a sign-in button they will press forever
is the worst available response, and a failure nobody is told about is one that stays broken.

Nothing in the repo pages anyone today, so "log it" currently means a structured log line and
nothing more. That is enough to make the failure findable and is not enough to make it noticed.

## Failure at the callback

The table above covers a token that fails verification. A sign-in can also be refused by the
provider before any token exists, which is a different union: `WorkOSAuthFailure`, fifteen values,
raised by the code exchange and by organization creation.

Uncaught, those reached the browser as the framework's serialised exception. A wrong API key
rendered `{"status":400,"message":"HTTPError"}`, which tells the person nothing and the operator
less. The same rule as above applies, and the same discipline: collapse them, and write down which
ones collapse.

| Disposition     | Reasons                                                                                                                         | What the person sees                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `retry`         | `rate-limited`, `unavailable`                                                                                                   | Temporarily unavailable, try again    |
| `unsupported`   | `email-verification-required`, `organization-selection-required`, the three `mfa-*`, `radar-challenge-required`, `sso-required` | A step this application has not built |
| `misconfigured` | `invalid-request`, `unauthorized`, `not-found`, `conflict`, `configuration`, `provider`                                         | Not set up correctly, recorded        |

**`retry` is the only one that tells someone to try again**, because waiting is the entire remedy
for exactly those two and advice that cannot work is worse than none.

**`unsupported` is honest rather than reassuring.** These are real AuthKit flows the template has
not built. Saying so stops a person pressing a button that cannot ever complete.

**`misconfigured` is ours.** The person reading it can do nothing about it, so it says so and the
failure is reported rather than only rendered. Catching an error to draw a page swallows the stack
trace the framework would have printed, and a callback that renders without reporting trades a bad
page for a silent outage. The default destination is one JSON line per failure on stderr,
overridable by the application.

**No message names the reason.** Several of these failures are indistinguishable from someone
probing the callback, and a message naming the failed check tells them which one to change.

## What is settled and what is not

Settled by this page: the screen list, automatic organization creation and its three rules, the
failure mapping, and that free-tier policy is out of scope for the template. The callback turned
out not to need a screen on the success path, for the reason recorded above.

**Built so far:** the signed-out page, the callback, and an unstyled signed-in page that prints the
Principal. The state check, the code exchange, organization creation, the refresh, and just in time
row creation all run, **proven by a real Google sign-in on 2026-08-24**, and the callback renders
the failure above for anything the provider refuses. What is not built: the email-code path, the
screens for a token that fails verification, and every steady-state surface.

Not settled: which feature the entitlement gate protects in a real product, where a `claims`
failure is delivered beyond a log line, and whether a second app in the template renders these
screens differently. The first two belong to the first product. The third is open question 4 in
[the auth proposal](auth-proposal.md).
