import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { t } from '@lingui/core/macro';
import { Section } from 'twenty-ui/components';

// Do not present an upstream vendor's signed DPA as an agreement with our operator.
export const SettingsLegalDpa = () => (
  <SettingsPageLayout title={t`Legal`} links={[{ children: t`Legal` }]}>
    <SettingsPageContainer>
      <Section.Root>
        <Section.Header
          title={__COMPANY__}
          description={t`Review the terms and privacy information for your workspace.`}
        />
        <p>
          <a
            href={__TERMS_URL__}
            target="_blank"
            rel="noopener noreferrer"
          >{t`Terms of service`}</a>
        </p>
        <p>
          <a
            href={__PRIVACY_URL__}
            target="_blank"
            rel="noopener noreferrer"
          >{t`Privacy policy`}</a>
        </p>
        <p>
          <a
            href={__DPA_URL__}
            target="_blank"
            rel="noopener noreferrer"
          >{t`Data Processing Agreement`}</a>
        </p>
        <p>
          <a
            href={__SUPPORT_URL__}
            target="_blank"
            rel="noopener noreferrer"
          >{t`Contact support`}</a>
        </p>
      </Section.Root>
    </SettingsPageContainer>
  </SettingsPageLayout>
);
