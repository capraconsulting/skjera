# ACC-07: Light and dark theme

The site and the studio come in a light and a dark theme. They follow the computer's appearance until the visitor picks one, with the button in the header or in **Account settings**.

## AC-1: The computer's theme, until one is picked

WHILE a visitor has not picked a theme, Skjera SHALL show the site in the light or dark theme as the computer's appearance is set.

**Test**

- **Given** every private window closed, a new one open, and the computer set to a dark appearance
- **When** you open http://localhost:5173
- **Then** the site is dark
- **When** you set the computer to a light appearance
- **Then** the site is light

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-2: The header button switches theme

WHEN a visitor clicks the theme button in the header, Skjera SHALL switch between the light and the dark theme.

**Test**

- **Given** the site in the dark theme
- **When** you click **Switch to light mode**, the sun in the header
- **Then** the site is light, and the button is now **Switch to dark mode**, a moon
- **When** you click it
- **Then** the site is dark

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-3: The choice is remembered

WHEN a visitor who has picked a theme comes back to the site in the same browser, Skjera SHALL show it in that theme, whatever the computer's appearance.

**Test**

- **Given** the computer set to a dark appearance, and **Switch to light mode** clicked
- **When** you reload the page
- **Then** the site is still light

**Automated:** `packages/app/e2e/specs/site.spec.ts`

## AC-4: Back to the computer's theme

WHEN a user picks **Same as the system** under **Theme** in **Account settings**, Skjera SHALL forget the theme picked and follow the computer's appearance again.

**Test**

- **Given** bob logged in, with **Dark** picked under **Theme** in **Account settings**, and the computer set to a light appearance
- **When** he picks **Same as the system**
- **Then** the site is light
- **When** he reloads the page
- **Then** it is still light, and **Same as the system** is picked

**Automated:** `packages/app/e2e/specs/site.spec.ts`
