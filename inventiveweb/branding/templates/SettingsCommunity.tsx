import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { t } from '@lingui/core/macro';
import { Section } from 'twenty-ui/components';

// InventiveWeb operator-owned help destinations; no upstream social/demo content.
export const SettingsCommunity = () => (
  <SettingsPageLayout
    title={t`Help & support`}
    links={[{ children: t`Help & support` }]}
  >
    <SettingsPageContainer>
      <Section.Root>
        <Section.Header
          title="InventiveWeb"
          description={t`Help with your workspace, setup, and business processes.`}
        />
        <p>
          <a
            href="/inventiveweb/help.html"
            target="_blank"
            rel="noopener noreferrer"
          >{t`Workspace guide`}</a>
        </p>
        <p>
          <a
            href={__SUPPORT_URL__}
            target="_blank"
            rel="noopener noreferrer"
          >{t`Contact support`}</a>
        </p>
        <p>
          <a
            href={__WEBSITE_URL__}
            target="_blank"
            rel="noopener noreferrer"
          >{t`Website`}</a>
        </p>
      </Section.Root>
      <Section.Root>
        <Section.Header title={t`About this workspace`} />
        <p>{__COMPANY__}</p>
        <p>
          <a
            href="/inventiveweb/source.html"
            target="_blank"
            rel="noopener noreferrer"
          >{t`Source & licences`}</a>
        </p>
      </Section.Root>
    </SettingsPageContainer>
  </SettingsPageLayout>
);
