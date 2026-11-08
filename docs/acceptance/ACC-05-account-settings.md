# ACC-05: Account menu and account settings

The account menu in the header says who is logged in, and leads to **Account settings** and **Log out**. **Account settings** shows the user's name and email, and holds their choice of language and theme.

## AC-1: The account menu says who is logged in

WHILE a user is logged in, the header SHALL show an account menu with their name and email, **Account settings** and **Log out**.

**Test**

- **Given** alice logged in
- **When** you click her name in the header
- **Then** the menu shows «alice» and «alice@example.com», **Account settings** and **Log out**

**Automated:** `packages/app/e2e/specs/site/siteAccount.spec.ts`

## AC-2: Name and email come from the login

**Account settings** SHALL show the user's name and email as the login provider gives them, and say that they are changed there.

**Test**

- **Given** alice logged in
- **When** you click **Account settings** in the account menu
- **Then** under **Profile** it shows **Name** «alice» and **Email** «alice@example.com», and «Your name and email come from where you log in, and are changed there.»

**Automated:** `packages/app/e2e/specs/site/siteAccount.spec.ts`

## AC-3: The language is picked in account settings

WHEN a user picks a language under **Language** in **Account settings**, Skjera SHALL show the page again in that language.

**Test**

- **Given** **Account settings** open, in English
- **When** you pick **Nynorsk**
- **Then** the page comes back in Nynorsk, headed «Kontoinnstillingar»
- **When** you pick **English**
- **Then** it is in English again

**Automated:** `packages/app/e2e/specs/site/siteAccount.spec.ts`

## AC-4: The theme is picked in account settings

WHEN a user picks **Light**, **Dark** or **Same as the system** under **Theme** in **Account settings**, Skjera SHALL show the site in that theme at once.

**Test**

- **Given** **Account settings** open, and the computer set to a light appearance
- **When** you pick **Dark**
- **Then** the page turns dark
- **When** you pick **Same as the system**
- **Then** it turns light again, as the computer is

**Automated:** `packages/app/e2e/specs/site/siteAccount.spec.ts`
