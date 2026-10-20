/** The 58 wilayas of Algeria (official numbering). Sétif is 19. */
export interface Wilaya {
  code: number;
  fr: string;
  ar: string;
}

export const WILAYAS: readonly Wilaya[] = [
  { code: 1, fr: "Adrar", ar: "أدرار" },
  { code: 2, fr: "Chlef", ar: "الشلف" },
  { code: 3, fr: "Laghouat", ar: "الأغواط" },
  { code: 4, fr: "Oum El Bouaghi", ar: "أم البواقي" },
  { code: 5, fr: "Batna", ar: "باتنة" },
  { code: 6, fr: "Béjaïa", ar: "بجاية" },
  { code: 7, fr: "Biskra", ar: "بسكرة" },
  { code: 8, fr: "Béchar", ar: "بشار" },
  { code: 9, fr: "Blida", ar: "البليدة" },
  { code: 10, fr: "Bouira", ar: "البويرة" },
  { code: 11, fr: "Tamanrasset", ar: "تمنراست" },
  { code: 12, fr: "Tébessa", ar: "تبسة" },
  { code: 13, fr: "Tlemcen", ar: "تلمسان" },
  { code: 14, fr: "Tiaret", ar: "تيارت" },
  { code: 15, fr: "Tizi Ouzou", ar: "تيزي وزو" },
  { code: 16, fr: "Alger", ar: "الجزائر" },
  { code: 17, fr: "Djelfa", ar: "الجلفة" },
  { code: 18, fr: "Jijel", ar: "جيجل" },
  { code: 19, fr: "Sétif", ar: "سطيف" },
  { code: 20, fr: "Saïda", ar: "سعيدة" },
  { code: 21, fr: "Skikda", ar: "سكيكدة" },
  { code: 22, fr: "Sidi Bel Abbès", ar: "سيدي بلعباس" },
  { code: 23, fr: "Annaba", ar: "عنابة" },
  { code: 24, fr: "Guelma", ar: "قالمة" },
  { code: 25, fr: "Constantine", ar: "قسنطينة" },
  { code: 26, fr: "Médéa", ar: "المدية" },
  { code: 27, fr: "Mostaganem", ar: "مستغانم" },
  { code: 28, fr: "M'Sila", ar: "المسيلة" },
  { code: 29, fr: "Mascara", ar: "معسكر" },
  { code: 30, fr: "Ouargla", ar: "ورقلة" },
  { code: 31, fr: "Oran", ar: "وهران" },
  { code: 32, fr: "El Bayadh", ar: "البيض" },
  { code: 33, fr: "Illizi", ar: "إليزي" },
  { code: 34, fr: "Bordj Bou Arréridj", ar: "برج بوعريريج" },
  { code: 35, fr: "Boumerdès", ar: "بومرداس" },
  { code: 36, fr: "El Tarf", ar: "الطارف" },
  { code: 37, fr: "Tindouf", ar: "تندوف" },
  { code: 38, fr: "Tissemsilt", ar: "تيسمسيلت" },
  { code: 39, fr: "El Oued", ar: "الوادي" },
  { code: 40, fr: "Khenchela", ar: "خنشلة" },
  { code: 41, fr: "Souk Ahras", ar: "سوق أهراس" },
  { code: 42, fr: "Tipaza", ar: "تيبازة" },
  { code: 43, fr: "Mila", ar: "ميلة" },
  { code: 44, fr: "Aïn Defla", ar: "عين الدفلى" },
  { code: 45, fr: "Naâma", ar: "النعامة" },
  { code: 46, fr: "Aïn Témouchent", ar: "عين تموشنت" },
  { code: 47, fr: "Ghardaïa", ar: "غرداية" },
  { code: 48, fr: "Relizane", ar: "غليزان" },
  { code: 49, fr: "Timimoun", ar: "تيميمون" },
  { code: 50, fr: "Bordj Badji Mokhtar", ar: "برج باجي مختار" },
  { code: 51, fr: "Ouled Djellal", ar: "أولاد جلال" },
  { code: 52, fr: "Béni Abbès", ar: "بني عباس" },
  { code: 53, fr: "In Salah", ar: "عين صالح" },
  { code: 54, fr: "In Guezzam", ar: "عين قزام" },
  { code: 55, fr: "Touggourt", ar: "تقرت" },
  { code: 56, fr: "Djanet", ar: "جانت" },
  { code: 57, fr: "El M'Ghair", ar: "المغير" },
  { code: 58, fr: "El Meniaa", ar: "المنيعة" },
];

export function wilayaName(code: number | null | undefined, locale: "ar" | "fr"): string | null {
  if (code == null) return null;
  const wilaya = WILAYAS.find((w) => w.code === code);
  return wilaya ? `${wilaya.code} · ${wilaya[locale]}` : null;
}
