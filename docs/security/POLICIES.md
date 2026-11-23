# Metriq security policies

Draft of 23 Nov 2026, for management to adopt. A policy counts for SOC 2 only once it is approved, signed and dated, and then reviewed once a year. Each section says what is done today and what the policy asks for from now on.

- Owner of these policies: Aaqib, until someone else is named.
- Approved by: ______________________
- Date: ______________________
- Next review: ______________________

## 1. Information security

- Metriq keeps each customer company's data apart from every other company's. Access is given only to people who need it for their work.
- Security is everyone's job. A suspected problem is reported at once to the owner of these policies.
- These policies apply to everyone with access to the Metriq servers, its code, its database, its backups or its customers' data.

## 2. Access control

- Every person has their own account, and nobody shares one.
- **Two-step sign-in is required for:**
  - every Metriq admin account;
  - the GitHub account;
  - the server's control panel;
  - the domain and Cloudflare accounts.
- **Server access:** only the people named in the access list, by SSH key. The list is kept and reviewed every quarter.
- **People who leave:** their access is removed on their last day. In Metriq that is Deactivate, which ends their sessions at once. Their SSH key and GitHub access go the same day.
- **Quarterly review:** who is a Super Admin, who has server access and who has GitHub write access. The review is recorded with its date and who did it.
- **Metriq support** reads a customer's data only while that customer allows help sign-in, for the time they set. This is built into the product.

## 3. Secrets

- Keys, tokens and passwords go only in `server/.env` on the server, with file mode 600.
- They are never in code, commits, patches, chat or logs.
- A key that may have leaked is replaced at once, and the replacement is recorded.
- Database credentials are used by the application only. People read production data through the application, never by hand.

## 4. Change management

- **Every change is made in git.** On each push, CI runs the type check, the build and every test.
- **Deploys** are made only from the `main` branch, by the deploy script. It backs up the database first.
- **The database** changes only through migrations, which the deploy runs. Nobody edits it by hand.
- **The server** runs only code pulled from GitHub. Nobody edits code on the server.
- **Before a Metra change goes live,** its check (`npm run metra:check`) must pass.

## 5. Incident response

1. **Notice.** From an alert, a customer or a person on the team.
2. **Contain.** Revoke keys, deactivate accounts, suspend a company from the owner console, or take the server off the network.
3. **Assess.** Work out what data, which companies and what period are affected.
4. **Tell** the affected customers without undue delay, and within 72 hours where the law requires it (GDPR). Say what happened, what data, and what they should do.
5. **Fix** the cause and check the fix.
6. **Write it up** within two weeks: timeline, cause, what changes. Keep the write-up.

Practise once a year with a tabletop exercise, for example "a team lead's password was leaked", and keep the notes.

## 6. Backup and recovery

- **Nightly:** the database is backed up every night and kept 14 days on the server.
- **Off the server:** a copy goes to another provider when `BACKUP_REMOTE` is set, and is kept 30 days.
- **Every quarter:** restore the newest backup into a scratch database with `scripts/restore-test.sh`, and keep the result.
- **Targets:** data loss of at most one day (RPO 24 hours). Back in service within one working day from a backup (RTO 24 hours).

## 7. Data retention and disposal

- A company's data is kept while it is a customer.
- A company can export all its data, or delete the company and everything it has, from Company settings, Your data. Deletion is immediate in the database, and backups age out within the backup period.
- Server logs are kept for ______ (decide, at least 1 year for SOC 2), off the server.

## 8. Vendors

Every vendor that stores or processes customer data is listed here. Each one's security report (SOC 2 or ISO 27001) is kept on file and reviewed once a year.

| Vendor | What it does | Customer data it sees | Report on file |
|---|---|---|---|
| VPS provider | Runs the server and database | All | |
| Cloudflare | DNS, TLS, proxy | Traffic passes through it | |
| GitHub | Code and CI | No customer data (CI uses an empty test database) | |
| Groq / OpenRouter | AI model for Metra and meeting notes | The question and the records Metra read for it | |
| Mailtrap | Sends email | Names and email addresses, email text | |
| Meta (WhatsApp), when used | Sends WhatsApp notifications | Phone number, notification text | |
| Stripe or Paddle, when used | Payments | Billing contact and payment details (held by them) | |
| Backup storage, when used | Off-server backups | All (encrypt with rclone crypt) | |

## 9. Risk assessment

Once a year, list each risk with how likely it is (1 to 5), how bad it would be (1 to 5), what is done about it, and who owns it. Start with these:

| Risk | Likely | Impact | Treatment | Owner |
|---|---|---|---|---|
| The single server fails | 2 | 4 | Nightly backups, restore test, off-server copy | |
| A Super Admin's password is stolen | 3 | 4 | Two-step sign-in required, activity log | |
| A bug shows one company's data to another | 1 | 5 | Company walls in the app and in the database; a test on every push | |
| A key in `.env` leaks | 2 | 5 | Mode 600; rotate on any doubt | |
| The AI model provider is down | 3 | 2 | Fallback models; Metra can be switched off per company | |
| Ransomware or deletion on the server | 2 | 5 | Off-server backups the server cannot delete | |

## 10. People

- People with production access agree to these policies in writing.
- They have a background check before they get access, where the law allows.
- They take security awareness training once a year, and a record is kept.
