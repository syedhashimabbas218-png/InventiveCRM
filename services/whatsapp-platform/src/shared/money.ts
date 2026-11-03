export const formatPence = (pence: number): string =>
  pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
