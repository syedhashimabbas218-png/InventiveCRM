import { type SettingsCustomizeVideoModalTab } from '@/settings/types/SettingsCustomizeVideoModalTab';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { type ReactNode } from 'react';
import { Card } from 'twenty-ui/primitives/surfaces';
import { themeCssVariables } from 'twenty-ui/theme';

const StyledCover = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[4]};
  padding: ${themeCssVariables.spacing[6]};
`;
const StyledLogo = styled.img`
  background: #fff;
  border-radius: ${themeCssVariables.border.radius.md};
  height: 72px;
  object-fit: contain;
  width: 72px;
`;

// Preserve the native card API while replacing vendor screenshots and videos.
type SettingsDiscoveryHeroCardProps = {
  lightSrc: string;
  darkSrc: string;
  instanceIdPrefix: string;
  tabs: SettingsCustomizeVideoModalTab[];
  coverHeight?: number;
  footer?: ReactNode;
  playButtonAriaLabel?: string;
};
export const SettingsDiscoveryHeroCard = ({
  footer,
}: SettingsDiscoveryHeroCardProps) => (
  <Card.Root rounded>
    <StyledCover>
      <StyledLogo src="/inventiveweb/logo.png" alt="InventiveWeb" />
      <div>
        <strong>InventiveWeb</strong>
        <p>
          <a
            href="/inventiveweb/help.html"
            target="_blank"
            rel="noopener noreferrer"
          >{t`Workspace guide`}</a>
        </p>
      </div>
    </StyledCover>
    {footer}
  </Card.Root>
);
