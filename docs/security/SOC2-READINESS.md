# SOC 2 readiness

Written 23 Nov 2026. This is the preparation for a SOC 2 audit, not the audit. Only a licensed CPA firm can audit and issue a SOC 2 report. The plan (docs/PLAN-2026-11.md, stage 4) says to start the audit once US mid-market buyers ask for it.

What this file is for:

1. To show an auditor, or a buyer's security questionnaire, which controls already exist and where they are in the code.
2. To list the gaps that must be closed before an audit can pass.

The policies an auditor asks for are in [POLICIES.md](POLICIES.md).

## Which report, and in what order

- **Type I** checks that the controls are designed right on one day.
- **Type II** checks that they worked over a period, usually 3 to 12 months.
- Buyers usually ask for Type II. The usual path is a readiness review, then Type I, then a Type II observation period.
- Scope: start with **Security** (the Common Criteria, required) and **Confidentiality**. Add **Availability** once there is more than one server.

## Controls that exist today

| Criterion | Control in Metriq | Where it is |
|---|---|---|
| CC6.1 Logical access | Every request is signed in; each company sees only its own records, enforced in the app and by a trigger on every table in the database | `server/src/middleware/auth.ts`, `server/src/lib/tenancy.ts`, `server/src/scripts/companyWallsSql.ts`, test `companyWalls.integration.test.ts` |
| CC6.1 Roles and least privilege | Roles (member, team lead, admin, QA), company roles with powers, department screens; finance only with the finance power | `server/src/lib/permissions.ts`, `server/src/lib/financeAccess.ts` |
| CC6.1 Authentication | Passwords hashed with bcrypt; two-step sign-in (authenticator app, recovery codes); a company can require it; single sign-on (SAML) with signed, single-use assertions | `server/src/lib/auth.ts`, `server/src/controllers/twoStepController.ts`, `server/src/lib/sso.ts`, tests `accountSecurity`, `sso` |
| CC6.2 Access granted and removed | Admins add and deactivate people; a deactivated person's sessions stop at once; "sessions valid from" ends every session after a password change | `server/src/controllers/adminController.ts`, `middleware/auth.ts` |
| CC6.3 Support access | Metriq support can sign in as a person only while the company allows it, for a limited time, and never to money, passwords or keys | `server/src/controllers/companyController.ts` (setSupportAccess), `middleware/auth.ts` |
| CC6.6 Brute force | Sign-in, password reset and the public API are rate limited | `server/src/middleware/rateLimit.ts`, `server/src/routes/publicApi.ts` |
| CC6.7 Data in transit | HTTPS through Cloudflare and nginx; security headers (helmet) | `server/src/app.ts`, server nginx config |
| CC6.8 Secrets | Keys only in `server/.env` (mode 600, never in git); API keys and webhook secrets stored hashed or shown once | `server/src/controllers/publicApiController.ts`, ops notes |
| CC7.2 Monitoring | Errors captured and grouped; hourly self check; uptime and job heartbeats; health alerts by email | `server/src/lib/health/` |
| CC7.3 Audit trail | Activity log of people, roles, settings, billing, two-step sign-in, API keys, requests and documents, each entry with a readable line | `server/src/lib/audit.ts`, Admin, Activity Log |
| CC8.1 Change management | Every change goes through git; CI runs the type check, the build and every test on each push; deploys only from `main`; the database changes only through migrations | `.github/workflows/tests.yml`, `scripts/server-deploy.sh` |
| A1.2 Backups | Nightly database backup kept 14 days; an off-server copy when `BACKUP_REMOTE` is set; a restore test script | `scripts/backup-db.sh`, `scripts/restore-test.sh` |
| C1.1 Confidential data | AI chats are private to the person; Metra answers only from records the person may open | `server/src/lib/metra/access.ts` |
| C1.2 Disposal | A company can export all its data and delete the company for good | `server/src/lib/companyData.ts`, Company settings, Your data |
| P (privacy, if in scope) | Privacy policy, terms, cookies and data processing agreement pages | `client/src/pages/marketing/` |

## Gaps to close before an audit

These are what an auditor would find missing today. The people column says who can close each one.

| Gap | What closes it | Who |
|---|---|---|
| No written, approved policies | Adopt [POLICIES.md](POLICIES.md); have them signed and dated by management; review once a year | Aaqib |
| No risk assessment | A yearly written risk assessment (the template is in POLICIES.md, section 9) | Aaqib |
| No access reviews | A quarterly review of who has admin rights, server access and GitHub access, kept as a record | Aaqib |
| No security awareness training | A yearly training for everyone with access to the server or customer data, with a record of who took it | Aaqib |
| No background checks | A check for people with production access, before they get it | Aaqib (HR) |
| No vendor reviews | A list of vendors that touch customer data, with each one's SOC 2 or ISO report on file (POLICIES.md, section 8) | Aaqib |
| No penetration test | A yearly test by an outside firm, with the findings fixed | Aaqib (vendor) |
| One server | No failover; recovery is from backup. Either accept it in the risk assessment, or add a second server before adding Availability to the scope | Aaqib |
| Encryption at rest | Depends on the VPS provider's disk; get it in writing, or encrypt the backups (rclone crypt) | Aaqib |
| Off-server backups not on yet | Set `BACKUP_REMOTE` and rclone on the server; run `scripts/restore-test.sh` every quarter and keep the result | Aaqib |
| Log retention | Decide how long application and access logs are kept (at least 1 year is common) and keep them off the server | Aaqib |
| Incident response never practised | One tabletop exercise a year, written up (POLICIES.md, section 5) | Aaqib |
| Two-step sign-in for the team that runs Metriq | Turn it on for every admin of 99 Technologies and for the server and GitHub accounts | Aaqib |

## Tools that make the audit cheaper

Vanta, Drata and Secureframe connect to GitHub and the cloud. They collect the evidence automatically, and many come with an audit firm. They usually cost less than doing it by hand once the Type II period starts.
