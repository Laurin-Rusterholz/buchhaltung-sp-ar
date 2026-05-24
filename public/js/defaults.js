// Schweizer Standard-Kontenplan für Vereine + Default-Einstellungen

export const DEFAULT_EINSTELLUNGEN = {
  name: 'Verein',
  untertitel: '',
  adresse: '',
  plz: '',
  ort: '',
  email: '',
  telefon: '',
  website: '',
  uid: '',
  bank: '',
  iban: '',
  bic: '',
  qr_iban: '',
  konto_eigenkapital: '2800',
  konto_ergebnis: '2900',
  konto_mitgliederbeitrag: '3000',
  konto_bank: '1020',
};

export const DEFAULT_KONTENPLAN = [
  // === Aktiven ===
  { nummer: '1000', bezeichnung: 'Kasse', typ: 'aktiv', kategorie: 'liquid' },
  { nummer: '1010', bezeichnung: 'PostFinance', typ: 'aktiv', kategorie: 'liquid' },
  { nummer: '1020', bezeichnung: 'Bank', typ: 'aktiv', kategorie: 'liquid' },
  { nummer: '1100', bezeichnung: 'Forderungen aus Lieferungen und Leistungen', typ: 'aktiv', kategorie: 'forderungen' },
  { nummer: '1109', bezeichnung: 'Wertberichtigung Forderungen', typ: 'aktiv', kategorie: 'forderungen' },
  { nummer: '1170', bezeichnung: 'Verrechnungssteuer', typ: 'aktiv', kategorie: '' },
  { nummer: '1200', bezeichnung: 'Vorräte', typ: 'aktiv', kategorie: '' },
  { nummer: '1300', bezeichnung: 'Aktive Rechnungsabgrenzung', typ: 'aktiv', kategorie: '' },
  { nummer: '1510', bezeichnung: 'Mobiliar und Einrichtungen', typ: 'aktiv', kategorie: 'anlage' },
  { nummer: '1520', bezeichnung: 'Büromaschinen, EDV', typ: 'aktiv', kategorie: 'anlage' },

  // === Passiven ===
  { nummer: '2000', bezeichnung: 'Verbindlichkeiten aus Lieferungen und Leistungen', typ: 'passiv', kategorie: '' },
  { nummer: '2100', bezeichnung: 'Kurzfristige Finanzverbindlichkeiten', typ: 'passiv', kategorie: '' },
  { nummer: '2200', bezeichnung: 'Sonstige kurzfristige Verbindlichkeiten', typ: 'passiv', kategorie: '' },
  { nummer: '2300', bezeichnung: 'Passive Rechnungsabgrenzung', typ: 'passiv', kategorie: '' },
  { nummer: '2400', bezeichnung: 'Langfristige Verbindlichkeiten', typ: 'passiv', kategorie: '' },
  { nummer: '2600', bezeichnung: 'Rückstellungen', typ: 'passiv', kategorie: '' },
  { nummer: '2800', bezeichnung: 'Vereinsvermögen', typ: 'passiv', kategorie: 'eigenkapital' },
  { nummer: '2900', bezeichnung: 'Jahresergebnis', typ: 'passiv', kategorie: 'eigenkapital' },

  // === Ertrag ===
  { nummer: '3000', bezeichnung: 'Mitgliederbeiträge', typ: 'ertrag', kategorie: '' },
  { nummer: '3100', bezeichnung: 'Spenden', typ: 'ertrag', kategorie: '' },
  { nummer: '3200', bezeichnung: 'Sponsoring', typ: 'ertrag', kategorie: '' },
  { nummer: '3300', bezeichnung: 'Veranstaltungserträge', typ: 'ertrag', kategorie: '' },
  { nummer: '3400', bezeichnung: 'Subventionen / Beiträge öffentliche Hand', typ: 'ertrag', kategorie: '' },
  { nummer: '3500', bezeichnung: 'Sonstige Erträge', typ: 'ertrag', kategorie: '' },
  { nummer: '3600', bezeichnung: 'Zinserträge', typ: 'ertrag', kategorie: '' },

  // === Aufwand ===
  { nummer: '4000', bezeichnung: 'Materialaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '4100', bezeichnung: 'Veranstaltungsaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '5000', bezeichnung: 'Honorare / Personalaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '5800', bezeichnung: 'Übriger Personalaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6000', bezeichnung: 'Raumaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6100', bezeichnung: 'Unterhalt, Reparaturen', typ: 'aufwand', kategorie: '' },
  { nummer: '6200', bezeichnung: 'Fahrzeug- und Transportaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6300', bezeichnung: 'Sachversicherungen, Gebühren', typ: 'aufwand', kategorie: '' },
  { nummer: '6400', bezeichnung: 'Energie- und Entsorgungsaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6500', bezeichnung: 'Verwaltungsaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6510', bezeichnung: 'Büromaterial, Drucksachen', typ: 'aufwand', kategorie: '' },
  { nummer: '6570', bezeichnung: 'Informatikaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6600', bezeichnung: 'Werbeaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6700', bezeichnung: 'Sonstiger Betriebsaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6800', bezeichnung: 'Abschreibungen', typ: 'aufwand', kategorie: '' },
  { nummer: '6900', bezeichnung: 'Finanzaufwand / Bankspesen', typ: 'aufwand', kategorie: '' },
];
