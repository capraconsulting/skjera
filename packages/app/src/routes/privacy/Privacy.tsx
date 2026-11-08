import { type Site, signupRetentionDays } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import type { ReactNode } from "react";
import { Button } from "../../components/Button.tsx";
import { currentSite } from "../../i18n.ts";
import { usePageTitle } from "../../pageTitle.ts";
import { sharesWithHubSpot, showCookieSettings } from "../../site/hubSpot.ts";
import styles from "./Privacy.module.css";

/**
 * With a policy kept elsewhere (SITE_PRIVACY_URL), /privacy sends the
 * visitor there, in its place in the history: Back leaves it.
 */
export const privacyLoader = () => {
  const { url } = currentSite().privacy;
  if (url === undefined) return null;
  window.location.replace(url);
  // The page is leaving: nothing to show meanwhile.
  return new Promise<null>(() => {});
};

const datatilsynet = "https://www.datatilsynet.no/";
const rightsPage =
  "https://www.datatilsynet.no/rettigheter-og-plikter/den-registrertes-rettigheter/";

export const privacyKeep = () => m.privacy_keep({ days: signupRetentionDays });
export const privacySignupBasis = () =>
  m.privacy_signup_basis({ days: signupRetentionDays });
export const privacyInvited = () =>
  m.privacy_invited({ days: signupRetentionDays });

/**
 * The privacy policy: ten sections, in the order of Skjer's policy. Who
 * answers for the data and how to reach them come from the site's
 * configuration (SITE_OPERATOR, SITE_OPERATOR_ORG_NUMBER,
 * SITE_OPERATOR_ADDRESS, SITE_CONTACT_EMAIL); a line whose setting is not set
 * is left out. What it says about Skjera is written for what Skjera does, and
 * the "last updated" date is changed with the text.
 */
export function Privacy() {
  const site = currentSite();
  const { name, privacy, hubSpot } = site;
  usePageTitle({ page: "privacy", heading: m.privacy_title() });
  const withHubSpot = hubSpot !== undefined;
  return (
    <article className={styles.privacy}>
      <h1 className={styles.heading}>{m.privacy_title()}</h1>

      <Part title={m.privacy_controller_heading()}>
        <p>
          {m.privacy_controller({ operator: privacy.operator, site: name })}
        </p>
        <Details privacy={privacy} />
        <p>{m.privacy_controller_serious()}</p>
      </Part>

      <Part title={m.privacy_rights_heading()}>
        <p>
          {m.privacy_rights_intro()}{" "}
          <a href={rightsPage}>{m.privacy_rights_datatilsynet()}</a>.
        </p>
        <ul>
          <Described lead={m.privacy_right_access_lead()}>
            {m.privacy_right_access()}
          </Described>
          <Described lead={m.privacy_right_erasure_lead()}>
            {m.privacy_right_erasure()}
          </Described>
          <Described lead={m.privacy_right_object_lead()}>
            {m.privacy_right_object()}
          </Described>
          <Described lead={m.privacy_right_portability_lead()}>
            {m.privacy_right_portability()}
          </Described>
          {withHubSpot ? (
            <li>
              <strong>{m.privacy_right_withdraw()}</strong>
            </li>
          ) : null}
        </ul>
        {withHubSpot ? (
          <Button className={styles.settings} onClick={showCookieSettings}>
            {m.privacy_cookie_settings()}
          </Button>
        ) : null}
        <p>
          {m.privacy_complaint()} <a href={datatilsynet}>www.datatilsynet.no</a>
          {m.privacy_complaint_contact()}
        </p>
      </Part>

      <Part title={m.privacy_subjects_heading()}>
        <p>{m.privacy_subjects_lead()}</p>
        <ul>
          <li>{m.privacy_subjects_attendees()}</li>
          <li>{m.privacy_subjects_visitors()}</li>
          <li>{m.privacy_subjects_organisers()}</li>
          <li>{m.privacy_subjects_invited()}</li>
        </ul>
      </Part>

      <Part title={m.privacy_collect_heading()}>
        <p>{m.privacy_collect_voluntary()}</p>
        <p>{m.privacy_collect_lead()}</p>
        <ul>
          <li>{m.privacy_collect_signup()}</li>
          <li>{m.privacy_collect_login()}</li>
          <li>{m.privacy_collect_use()}</li>
          <li>{m.privacy_collect_email()}</li>
          <li>{m.privacy_collect_invited()}</li>
        </ul>
      </Part>

      <Part title={m.privacy_purpose_heading()}>
        <p>{m.privacy_purpose_lead()}</p>
        <ul>
          <li>{m.privacy_purpose_consent()}</li>
          <li>{m.privacy_purpose_contract()}</li>
          <li>{m.privacy_purpose_legal()}</li>
          <li>{m.privacy_purpose_vital()}</li>
          <li>{m.privacy_purpose_public()}</li>
          <li>{m.privacy_purpose_legitimate()}</li>
        </ul>
        <p>{m.privacy_purpose_minimal()}</p>
        <p>{privacyKeep()}</p>
      </Part>

      <Part title={m.privacy_processing_heading()}>
        <p>{m.privacy_processing_lead()}</p>
        <h3>{m.privacy_signup_heading()}</h3>
        <p>{m.privacy_signup_data()}</p>
        <p>{m.privacy_signup_visible()}</p>
        <p>{m.privacy_signup_emails()}</p>
        <p>{privacySignupBasis()}</p>
        <h3>{m.privacy_invited_heading()}</h3>
        <p>{privacyInvited()}</p>
        <h3>{m.privacy_login_heading()}</h3>
        <p>{m.privacy_login()}</p>
        <h3>{m.privacy_use_heading()}</h3>
        <p>{m.privacy_use()}</p>
        <p>
          {m.privacy_use_basis()}
          {withHubSpot ? ` ${m.privacy_use_consent()}` : null}
        </p>
        <h3>{m.privacy_contacting_heading()}</h3>
        <p>{m.privacy_contacting()}</p>
        <p>
          <strong>{m.privacy_contacting_basis_lead()}</strong>{" "}
          {m.privacy_contacting_basis()}
        </p>
      </Part>

      <Part title={m.privacy_sharing_heading()}>
        <p>{m.privacy_sharing_lead()}</p>
        <ul>
          <li>{m.privacy_shared_operations()}</li>
          <li>{m.privacy_shared_email()}</li>
          <li>{m.privacy_shared_storage()}</li>
          <li>{m.privacy_shared_login()}</li>
          {sharesWithHubSpot(site) ? (
            <li>
              {withHubSpot
                ? site.salesEvents === true
                  ? m.privacy_shared_hubspot_and_sales()
                  : m.privacy_shared_hubspot()
                : m.privacy_shared_hubspot_sales()}
            </li>
          ) : null}
          <li>{m.privacy_shared_authorities()}</li>
        </ul>
        <p>{m.privacy_sharing_agreements()}</p>
      </Part>

      <Part title={m.privacy_security_heading()}>
        <p>{m.privacy_security_lead()}</p>
        <ul>
          <li>{m.privacy_security_login()}</li>
          <li>{m.privacy_security_domains()}</li>
          <li>{m.privacy_security_access()}</li>
          <li>{m.privacy_security_guest_link()}</li>
        </ul>
        <p>{m.privacy_security_purpose()}</p>
        <p>{m.privacy_security_providers()}</p>
      </Part>

      <Part title={m.privacy_cookies_heading()}>
        <p>{m.privacy_cookies_lead()}</p>
        <ul>
          <Described lead={m.privacy_cookies_necessary_lead()}>
            {m.privacy_cookies_necessary()}
          </Described>
          {withHubSpot ? (
            <>
              <Described lead={m.privacy_cookies_analytics_lead()}>
                {m.privacy_cookies_analytics()}
              </Described>
              <Described lead={m.privacy_cookies_marketing_lead()}>
                {m.privacy_cookies_marketing()}
              </Described>
            </>
          ) : null}
        </ul>
        <p>{m.privacy_cookies_browser()}</p>
        <p>
          {withHubSpot
            ? m.privacy_cookies_change()
            : m.privacy_cookies_untracked()}
        </p>
      </Part>

      <Part title={m.privacy_contact_heading()}>
        <p>{m.privacy_contact_lead()}</p>
        <Contact privacy={privacy} />
      </Part>

      <p className={styles.updated}>
        <em>{m.privacy_updated()}</em>
      </p>
    </article>
  );
}

function Part(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className={styles.part}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

/** A list item opening with a bold lead-in. */
function Described(props: {
  readonly lead: string;
  readonly children: ReactNode;
}) {
  return (
    <li>
      <strong>{props.lead}</strong> {props.children}
    </li>
  );
}

/** The operator's contact block: the lines whose settings are set. */
function Details({ privacy }: { readonly privacy: Site["privacy"] }) {
  const { operator, address, orgNumber, contact } = privacy;
  return (
    <address className={styles.details}>
      <strong>{m.privacy_controller_contact()}</strong>
      <span>{operator}</span>
      {address === undefined ? null : (
        <span>{m.privacy_controller_address({ address })}</span>
      )}
      {orgNumber === undefined ? null : (
        <span>{m.privacy_controller_org_number({ orgNumber })}</span>
      )}
      {contact === undefined ? null : (
        <span>
          {m.privacy_controller_email()}{" "}
          <a href={`mailto:${contact}`}>{contact}</a>
        </span>
      )}
    </address>
  );
}

/** Where to write to: the e-mail address, or whom to ask without one. */
function Contact({ privacy }: { readonly privacy: Site["privacy"] }) {
  const { operator, address, contact } = privacy;
  return (
    <address className={styles.details}>
      <strong>{operator}</strong>
      <span>{m.privacy_contact_attn()}</span>
      {address === undefined ? null : <span>{address}</span>}
      <span>
        {contact === undefined ? (
          m.privacy_ask_operator({ operator })
        ) : (
          <a href={`mailto:${contact}`}>{contact}</a>
        )}
      </span>
    </address>
  );
}
