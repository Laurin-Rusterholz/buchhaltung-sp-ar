// Schweizer Standard-Kontenplan + Vereins-spezifischer Default (SP AR)
// + Default-Einstellungen + Mail/Brief-Vorlagen

export const DEFAULT_EINSTELLUNGEN = {
  name: 'SP AR',
  untertitel: 'Sozialdemokratische Partei Appenzell Ausserrhoden',
  adresse: '',
  plz: '',
  ort: '',
  email: '',
  telefon: '',
  website: '',
  uid: '',
  bank: 'Raiffeisenbank Heiden',
  iban: '',
  bic: '',
  qr_iban: '',
  konto_eigenkapital: '2710',
  konto_ergebnis: '',
  konto_mitgliederbeitrag: '3001',
  konto_bank: '1020',
};

// Kontenplan SP AR (aus offiziellem Kontenplan übernommen)
export const DEFAULT_KONTENPLAN = [
  // === Aktiven ===
  { nummer: '1000', bezeichnung: 'Kasse', typ: 'aktiv', kategorie: 'liquid' },
  { nummer: '1020', bezeichnung: 'Raiffeisenbank Heiden', typ: 'aktiv', kategorie: 'liquid' },
  { nummer: '1100', bezeichnung: 'Offene Forderungen', typ: 'aktiv', kategorie: 'forderungen' },
  { nummer: '1200', bezeichnung: 'Aktive Rechnungsabgrenzung', typ: 'aktiv', kategorie: '' },
  { nummer: '1500', bezeichnung: 'Mobiliar – Informatik', typ: 'aktiv', kategorie: 'anlage' },

  // === Passiven ===
  { nummer: '2000', bezeichnung: 'Verbindlichkeiten', typ: 'passiv', kategorie: '' },
  { nummer: '2300', bezeichnung: 'Passive Rechnungsabgrenzung', typ: 'passiv', kategorie: '' },
  { nummer: '2710', bezeichnung: 'Zweckgebunden Sekretariat 1 – SP AR', typ: 'passiv', kategorie: 'eigenkapital' },
  { nummer: '2720', bezeichnung: 'Zweckgebunden Kantonsrat Fraktion', typ: 'passiv', kategorie: 'eigenkapital' },

  // === Erträge ===
  { nummer: '3001', bezeichnung: 'Sektionsbeiträge', typ: 'ertrag', kategorie: 'mitgliederbeitraege' },
  { nummer: '3002', bezeichnung: 'Beiträge Mandatsträger:innen', typ: 'ertrag', kategorie: 'mitgliederbeitraege' },
  { nummer: '3003', bezeichnung: 'Diverse Zuwendungen von SP AR – Mitgliedern', typ: 'ertrag', kategorie: 'mitgliederbeitraege' },
  { nummer: '3201', bezeichnung: 'Spenden und Vergabungen (allgemein)', typ: 'ertrag', kategorie: 'spenden' },
  { nummer: '3202', bezeichnung: 'Spenden und Vergabungen (Projekte)', typ: 'ertrag', kategorie: 'spenden' },
  { nummer: '3210', bezeichnung: 'Einnahmen Veranstaltungen', typ: 'ertrag', kategorie: '' },
  { nummer: '3211', bezeichnung: 'Beitrag Kanton AR z.G.v. Fraktion', typ: 'ertrag', kategorie: '' },

  // === Aufwand – Material Sekretariat ===
  { nummer: '4101', bezeichnung: 'Materialeinkauf', typ: 'aufwand', kategorie: 'sekretariat' },
  { nummer: '4102', bezeichnung: 'Unterhalt, Reparaturen und Ersatz', typ: 'aufwand', kategorie: 'sekretariat' },
  { nummer: '4103', bezeichnung: 'Telefon', typ: 'aufwand', kategorie: 'sekretariat' },
  { nummer: '4104', bezeichnung: 'Internet', typ: 'aufwand', kategorie: 'sekretariat' },
  { nummer: '4105', bezeichnung: 'Porto', typ: 'aufwand', kategorie: 'sekretariat' },
  { nummer: '4106', bezeichnung: 'Diverse Spesen Sekretariat', typ: 'aufwand', kategorie: 'sekretariat' },
  { nummer: '4107', bezeichnung: 'Zeitschriften, Zeitungen, Bücher etc.', typ: 'aufwand', kategorie: 'sekretariat' },
  { nummer: '4108', bezeichnung: 'Leasing', typ: 'aufwand', kategorie: 'sekretariat' },

  // === Aufwand – Vorstand + Veranstaltungen ===
  { nummer: '4210', bezeichnung: 'Vorstandssitzungen', typ: 'aufwand', kategorie: 'vorstand' },
  { nummer: '4211', bezeichnung: 'Delegiertenversammlungen', typ: 'aufwand', kategorie: 'vorstand' },
  { nummer: '4212', bezeichnung: 'Parteitage', typ: 'aufwand', kategorie: 'vorstand' },
  { nummer: '4213', bezeichnung: 'Vorstand', typ: 'aufwand', kategorie: 'vorstand' },
  { nummer: '4214', bezeichnung: 'Sitzungen', typ: 'aufwand', kategorie: 'vorstand' },
  { nummer: '4219', bezeichnung: 'Sonstige Veranstaltungen', typ: 'aufwand', kategorie: 'vorstand' },
  { nummer: '4250', bezeichnung: 'Mitgliedschaften, Beiträge – SPS', typ: 'aufwand', kategorie: 'mitgliedschaften' },
  { nummer: '4251', bezeichnung: 'Mitgliedschaften, Beiträge – sonstige', typ: 'aufwand', kategorie: 'mitgliedschaften' },
  { nummer: '4252', bezeichnung: 'Beiträge SP AR Fraktion', typ: 'aufwand', kategorie: 'mitgliedschaften' },

  // === Personalaufwand ===
  { nummer: '5000', bezeichnung: 'Löhne (Sekretariat)', typ: 'aufwand', kategorie: 'personal' },
  { nummer: '5001', bezeichnung: 'Sekretariat SP AR', typ: 'aufwand', kategorie: 'personal' },
  { nummer: '5110', bezeichnung: 'AHV/IV/EO/ALV', typ: 'aufwand', kategorie: 'personal' },
  { nummer: '5111', bezeichnung: 'BVG', typ: 'aufwand', kategorie: 'personal' },
  { nummer: '5112', bezeichnung: 'UVG', typ: 'aufwand', kategorie: 'personal' },
  { nummer: '5113', bezeichnung: 'Berufsunfallversicherung', typ: 'aufwand', kategorie: 'personal' },
  { nummer: '5114', bezeichnung: 'Krankentaggeldversicherung', typ: 'aufwand', kategorie: 'personal' },

  // === Übriger betrieblicher Aufwand ===
  { nummer: '6210', bezeichnung: 'Informatik (Server, Lizenzen etc.)', typ: 'aufwand', kategorie: 'informatik' },
  { nummer: '6220', bezeichnung: 'Website / Social Media', typ: 'aufwand', kategorie: 'informatik' },
  { nummer: '6230', bezeichnung: 'Inserate / PR', typ: 'aufwand', kategorie: 'werbung' },
  { nummer: '6240', bezeichnung: 'Drucksachen, Werbematerial', typ: 'aufwand', kategorie: 'werbung' },

  // === Abstimmungen / Wahlen ===
  { nummer: '8513', bezeichnung: 'Abstimmungsbeitrag 1 – SPS', typ: 'aufwand', kategorie: 'abstimmungen' },
  { nummer: '8514', bezeichnung: 'Abstimmungsbeitrag 2 – Juso', typ: 'aufwand', kategorie: 'abstimmungen' },

  // === Finanzergebnis ===
  { nummer: '8700', bezeichnung: 'Bankspesen', typ: 'aufwand', kategorie: 'finanz' },
  { nummer: '8710', bezeichnung: 'Erträge aus Bankguthaben', typ: 'ertrag', kategorie: 'finanz' },

  // === Ausserordentlich ===
  { nummer: '8800', bezeichnung: 'Ausserordentlicher Aufwand', typ: 'aufwand', kategorie: 'ausserordentlich' },
  { nummer: '8810', bezeichnung: 'Ausserordentlicher Ertrag', typ: 'ertrag', kategorie: 'ausserordentlich' },
];

// Generischer Schweizer Vereins-Kontenplan (Fallback / Alternative)
export const KONTENPLAN_GENERIC = [
  { nummer: '1000', bezeichnung: 'Kasse', typ: 'aktiv', kategorie: 'liquid' },
  { nummer: '1010', bezeichnung: 'PostFinance', typ: 'aktiv', kategorie: 'liquid' },
  { nummer: '1020', bezeichnung: 'Bank', typ: 'aktiv', kategorie: 'liquid' },
  { nummer: '1100', bezeichnung: 'Forderungen aus Lieferungen und Leistungen', typ: 'aktiv', kategorie: 'forderungen' },
  { nummer: '1300', bezeichnung: 'Aktive Rechnungsabgrenzung', typ: 'aktiv', kategorie: '' },
  { nummer: '2000', bezeichnung: 'Verbindlichkeiten aus L+L', typ: 'passiv', kategorie: '' },
  { nummer: '2300', bezeichnung: 'Passive Rechnungsabgrenzung', typ: 'passiv', kategorie: '' },
  { nummer: '2800', bezeichnung: 'Vereinsvermögen', typ: 'passiv', kategorie: 'eigenkapital' },
  { nummer: '3000', bezeichnung: 'Mitgliederbeiträge', typ: 'ertrag', kategorie: 'mitgliederbeitraege' },
  { nummer: '3100', bezeichnung: 'Spenden', typ: 'ertrag', kategorie: 'spenden' },
  { nummer: '3200', bezeichnung: 'Veranstaltungserträge', typ: 'ertrag', kategorie: '' },
  { nummer: '4000', bezeichnung: 'Veranstaltungsaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '5000', bezeichnung: 'Personalaufwand', typ: 'aufwand', kategorie: 'personal' },
  { nummer: '6500', bezeichnung: 'Verwaltungsaufwand', typ: 'aufwand', kategorie: '' },
  { nummer: '6900', bezeichnung: 'Bankspesen', typ: 'aufwand', kategorie: 'finanz' },
];

// Standard-Vorlagen für Dokumente und Mails
export const DEFAULT_VORLAGEN = [
  {
    id: 'v-mitgliederbeitrag',
    name: 'Mitgliederbeitrag-Aufforderung',
    typ: 'mail',
    betreff: 'Mitgliederbeitrag {{jahr}} – {{verein_name}}',
    inhalt: `Liebe:r {{vorname}}

Vielen Dank für deine Mitgliedschaft bei der {{verein_name}}.

Der Mitgliederbeitrag für das Jahr {{jahr}} beträgt CHF {{beitrag}}.
Wir bitten dich um Überweisung auf folgendes Konto:

IBAN: {{verein_iban}}
Bank: {{verein_bank}}
Vermerk: Mitgliederbeitrag {{jahr}} – {{vorname}} {{nachname}}

Mit solidarischen Grüssen
Vorstand {{verein_name}}`,
  },
  {
    id: 'v-mahnung',
    name: 'Mahnung Mitgliederbeitrag',
    typ: 'mail',
    betreff: 'Erinnerung: Mitgliederbeitrag {{jahr}}',
    inhalt: `Liebe:r {{vorname}}

Wir haben deinen Mitgliederbeitrag für {{jahr}} (CHF {{beitrag}}) noch nicht
verbucht. Vielleicht ist es untergegangen – kein Problem.

Du kannst den Betrag bequem auf folgendes Konto überweisen:
IBAN: {{verein_iban}}
Vermerk: Mitgliederbeitrag {{jahr}}

Bei Fragen melde dich gerne.

Solidarische Grüsse
Vorstand {{verein_name}}`,
  },
  {
    id: 'v-begruessung',
    name: 'Begrüssung Neumitglied',
    typ: 'mail',
    betreff: 'Willkommen bei der {{verein_name}}',
    inhalt: `Liebe:r {{vorname}}

Wir freuen uns sehr, dich als neues Mitglied bei der {{verein_name}}
begrüssen zu dürfen!

Du wirst in den nächsten Wochen Informationen zu unseren Aktivitäten,
Veranstaltungen und Versammlungen erhalten.

Dein Jahresbeitrag beträgt CHF {{beitrag}} und kann auf folgendes Konto
überwiesen werden:
IBAN: {{verein_iban}}

Herzlich willkommen!
Vorstand {{verein_name}}`,
  },
  {
    id: 'v-einladung',
    name: 'Einladung Veranstaltung',
    typ: 'mail',
    betreff: '[BITTE ANPASSEN] Einladung Veranstaltung',
    inhalt: `Liebe:r {{vorname}}

Wir laden dich herzlich zu unserer Veranstaltung ein:

[Datum:]
[Ort:]
[Programm:]

Wir freuen uns auf dein Kommen.

Mit solidarischen Grüssen
Vorstand {{verein_name}}`,
  },
];
