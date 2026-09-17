import { Img } from 'react-email';

const logoStyle = {
  marginBottom: '40px',
};

export const Logo = () => {
  return (
    <Img
      src="https://localhost/branding/email-logo.png"
      alt="InventiveCRM logo"
      width="40"
      height="40"
      style={logoStyle}
    />
  );
};
