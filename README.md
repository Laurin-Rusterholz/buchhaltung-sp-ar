# Vereinsbuchhaltung (Basis SP AR)

Umfassende Buchhaltungs-Webapp für Schweizer Vereine. Doppelte Buchhaltung,
Schweizer Vereins-Kontenplan, Mitglieder-, Rechnungs- und Belegverwaltung,
Bilanz und Erfolgsrechnung. Läuft komplett auf Netlify (Static + Functions
+ Blobs).

## Funktionsumfang

- **Dashboard** – Kennzahlen, Kontostände, letzte Buchungen
- **Kontenplan** – Schweizer Vereins-Standardkontenplan vorinstalliert, frei
  erweiterbar
- **Buchungen** – Doppelte Buchhaltung (Soll/Haben), Journal, Kontenblatt
- **Mitglieder** – Stammdaten, Beitragskategorien, Status
- **Rechnungen** – Rechnungsstellung an Mitglieder oder Externe, Statusverfolgung
- **Belege** – Upload (PDF/Bild) und Verknüpfung mit Buchungen
- **Berichte** – Bilanz, Erfolgsrechnung, Journal, Kontoauszug; Druck/PDF
  über Browser
- **Geschäftsjahre** – Mehrjahresfähigkeit, Jahresabschluss
- **Einstellungen** – Vereinsdaten, Logo, Standardkonten

## Tech-Stack

- **Frontend**: statisches HTML + ES-Module (kein Build nötig)
- **Backend**: Netlify Functions (Node 20, ESM)
- **Storage**: Netlify Blobs (`data` Store für JSON, `files` Store für Belege)
- **Deployment**: Netlify

## Lokal entwickeln

```bash
npm install
npx netlify dev
```

Netlify CLI startet lokal das Frontend und emuliert Functions + Blobs.
Beim ersten Aufruf wird ein Standard-Kontenplan angelegt.

## Auf Netlify deployen

1. Repository mit Netlify verbinden (Site importieren).
2. Build-Settings werden aus `netlify.toml` gelesen – nichts zu konfigurieren.
3. Blobs sind ohne weitere Konfiguration aktiv.

## Datenstruktur (Blobs)

| Store   | Key                          | Inhalt                          |
|---------|------------------------------|---------------------------------|
| `data`  | `einstellungen`              | Vereinsstammdaten               |
| `data`  | `kontenplan`                 | Liste aller Konten              |
| `data`  | `geschaeftsjahre`            | Liste der Geschäftsjahre        |
| `data`  | `buchungen/<jahr>`           | Journal pro Geschäftsjahr       |
| `data`  | `mitglieder`                 | Mitgliederliste                 |
| `data`  | `rechnungen/<jahr>`          | Rechnungen pro Geschäftsjahr    |
| `data`  | `belege-meta`                | Metadaten aller Belege          |
| `files` | `belege/<id>`                | Belegdatei (binär)              |

## Anpassen

Die App ist bewusst minimalistisch gehalten und ohne Framework gebaut.
Alle Views liegen in `public/js/views/`, alle Backend-Endpoints in
`netlify/functions/`. Erweiterungen wie Authentifizierung, QR-Rechnung
oder MWST können nach Bedarf ergänzt werden.

### Authentifizierung

Aktuell ist **keine Authentifizierung** eingebaut. Für den produktiven
Einsatz unbedingt eines der folgenden ergänzen:
- Netlify Identity / Auth
- Basic Auth via Edge Function
- Passwortschutz via Environment-Variable

### Theming

Farben und Branding in `public/styles.css` über CSS-Variablen anpassbar
(`--color-primary` etc.).
