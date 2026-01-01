// Nigerian Banks List
export interface Bank {
  name: string;
  code: string;
  type: 'commercial' | 'microfinance' | 'merchant' | 'non-interest';
}

export const NIGERIAN_BANKS: Bank[] = [
  { name: 'Access Bank', code: '044', type: 'commercial' },
  { name: 'Citibank', code: '023', type: 'commercial' },
  { name: 'Diamond Bank', code: '063', type: 'commercial' },
  { name: 'Ecobank Nigeria', code: '050', type: 'commercial' },
  { name: 'Fidelity Bank', code: '070', type: 'commercial' },
  { name: 'First Bank of Nigeria', code: '011', type: 'commercial' },
  { name: 'First City Monument Bank', code: '214', type: 'commercial' },
  { name: 'Guaranty Trust Bank', code: '058', type: 'commercial' },
  { name: 'Heritage Bank', code: '030', type: 'commercial' },
  { name: 'Jaiz Bank', code: '301', type: 'non-interest' },
  { name: 'Keystone Bank', code: '082', type: 'commercial' },
  { name: 'Providus Bank', code: '101', type: 'commercial' },
  { name: 'Polaris Bank', code: '076', type: 'commercial' },
  { name: 'Stanbic IBTC Bank', code: '221', type: 'commercial' },
  { name: 'Standard Chartered Bank', code: '068', type: 'commercial' },
  { name: 'Sterling Bank', code: '232', type: 'commercial' },
  { name: 'Suntrust Bank', code: '100', type: 'commercial' },
  { name: 'Union Bank of Nigeria', code: '032', type: 'commercial' },
  { name: 'United Bank For Africa', code: '033', type: 'commercial' },
  { name: 'Unity Bank', code: '215', type: 'commercial' },
  { name: 'Wema Bank', code: '035', type: 'commercial' },
  { name: 'Zenith Bank', code: '057', type: 'commercial' },
];

export function getBankByCode(code: string): Bank | undefined {
  return NIGERIAN_BANKS.find(bank => bank.code === code);
}

export function searchBanks(query: string): Bank[] {
  const lowerQuery = query.toLowerCase();
  return NIGERIAN_BANKS.filter(
    bank => 
      bank.name.toLowerCase().includes(lowerQuery) ||
      bank.code.includes(query)
  );
}

