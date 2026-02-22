export interface NigeriaLocationOption {
  state: string;
  city: string;
  label: string;
}

const STATE_CAPITALS: Array<{ state: string; capital: string }> = [
  { state: 'Abia', capital: 'Umuahia' },
  { state: 'Adamawa', capital: 'Yola' },
  { state: 'Akwa Ibom', capital: 'Uyo' },
  { state: 'Anambra', capital: 'Awka' },
  { state: 'Bauchi', capital: 'Bauchi' },
  { state: 'Bayelsa', capital: 'Yenagoa' },
  { state: 'Benue', capital: 'Makurdi' },
  { state: 'Borno', capital: 'Maiduguri' },
  { state: 'Cross River', capital: 'Calabar' },
  { state: 'Delta', capital: 'Asaba' },
  { state: 'Ebonyi', capital: 'Abakaliki' },
  { state: 'Edo', capital: 'Benin City' },
  { state: 'Ekiti', capital: 'Ado-Ekiti' },
  { state: 'Enugu', capital: 'Enugu' },
  { state: 'Federal Capital Territory', capital: 'Abuja' },
  { state: 'Gombe', capital: 'Gombe' },
  { state: 'Imo', capital: 'Owerri' },
  { state: 'Jigawa', capital: 'Dutse' },
  { state: 'Kaduna', capital: 'Kaduna' },
  { state: 'Kano', capital: 'Kano' },
  { state: 'Katsina', capital: 'Katsina' },
  { state: 'Kebbi', capital: 'Birnin Kebbi' },
  { state: 'Kogi', capital: 'Lokoja' },
  { state: 'Kwara', capital: 'Ilorin' },
  { state: 'Lagos', capital: 'Ikeja' },
  { state: 'Nasarawa', capital: 'Lafia' },
  { state: 'Niger', capital: 'Minna' },
  { state: 'Ogun', capital: 'Abeokuta' },
  { state: 'Ondo', capital: 'Akure' },
  { state: 'Osun', capital: 'Osogbo' },
  { state: 'Oyo', capital: 'Ibadan' },
  { state: 'Plateau', capital: 'Jos' },
  { state: 'Rivers', capital: 'Port Harcourt' },
  { state: 'Sokoto', capital: 'Sokoto' },
  { state: 'Taraba', capital: 'Jalingo' },
  { state: 'Yobe', capital: 'Damaturu' },
  { state: 'Zamfara', capital: 'Gusau' },
];

const EXTRA_CITIES_BY_STATE: Record<string, string[]> = {
  Abia: ['Aba'],
  Adamawa: ['Mubi', 'Numan'],
  'Akwa Ibom': ['Eket', 'Ikot Ekpene'],
  Anambra: ['Onitsha', 'Nnewi'],
  Bauchi: ['Azare', 'Misau'],
  Bayelsa: ['Ogbia', 'Sagbama'],
  Benue: ['Gboko', 'Otukpo'],
  Borno: ['Biu', 'Bama'],
  'Cross River': ['Ikom', 'Ugep'],
  Delta: ['Warri', 'Sapele'],
  Ebonyi: ['Afikpo', 'Onueke'],
  Edo: ['Auchi', 'Ekpoma'],
  Ekiti: ['Ikere-Ekiti', 'Ilawe-Ekiti'],
  Enugu: ['Nsukka', 'Awgu'],
  'Federal Capital Territory': ['Gwagwalada', 'Kubwa'],
  Gombe: ['Kaltungo', 'Bajoga'],
  Imo: ['Orlu', 'Okigwe'],
  Jigawa: ['Hadejia', 'Gumel'],
  Kaduna: ['Zaria', 'Kafanchan'],
  Kano: ['Wudil', 'Bichi'],
  Katsina: ['Daura', 'Funtua'],
  Kebbi: ['Argungu', 'Yauri'],
  Kogi: ['Okene', 'Anyigba'],
  Kwara: ['Offa', 'Omu-Aran'],
  Lagos: ['Lekki', 'Epe'],
  Nasarawa: ['Keffi', 'Akwanga'],
  Niger: ['Suleja', 'Bida'],
  Ogun: ['Ijebu Ode', 'Sango Ota'],
  Ondo: ['Ondo', 'Owo'],
  Osun: ['Ile-Ife', 'Ilesa'],
  Oyo: ['Ogbomosho', 'Oyo'],
  Plateau: ['Bukuru', 'Pankshin'],
  Rivers: ['Obio-Akpor', 'Bonny'],
  Sokoto: ['Tambuwal', 'Gwadabawa'],
  Taraba: ['Wukari', 'Bali'],
  Yobe: ['Potiskum', 'Nguru'],
  Zamfara: ['Kaura Namoda', 'Talata Mafara'],
};

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export const NIGERIA_LOCATION_OPTIONS: NigeriaLocationOption[] = STATE_CAPITALS.flatMap(
  ({ state, capital }) => {
    const cities = uniqueStrings([capital, ...(EXTRA_CITIES_BY_STATE[state] ?? [])]);
    return cities.map((city) => ({
      state,
      city,
      label: `${city}, ${state}`,
    }));
  }
);

