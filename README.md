# Vereinsbuchhaltung (Basis SP AR)

Umfassende Buchhaltungs-Webapp für Schweizer Vereine. Doppelte Buchhaltung,
Schweizer Vereins-Kontenplan, Mitglieder-, Rechnungs- und Belegverwaltung,
Bilanz und Erfolgsrechnung. Statische Webapp – kein Backend nötig.

Persistenz und Datei-Uploads laufen direkt aus dem Browser gegen
**Firebase Storage**. Deployment auf Netlify.

## Funktionsumfang

- **Dashboard** – Kennzahlen, Kontostände, letzte Buchungen
- **Kontenplan** – Schweizer Vereins-Standardkontenplan vorinstalliert, frei
  erweiterbar; Zurücksetzen auf Standard / leer; ✨ AI-Kontenplan-Generator
- **Buchungen** – Doppelte Buchhaltung (Soll/Haben), Journal, Kontenblatt;
  ✨ AI-Buchungsvorschlag aus Beschreibung
- **Mitglieder** – Stammdaten, Beitragskategorien, Status
- **Rechnungen** – Rechnungsstellung an Mitglieder oder Externe, Statusverfolgung
- **Belege** – Upload (PDF/Bild/etc., bis 50 MB) und Verknüpfung mit Buchungen;
  ✨ AI-Auto-Analyse von Quittungen (OCR via Gemini Vision)
- **Berichte** – Bilanz, Erfolgsrechnung, Journal, Kontoauszug; Druck/PDF
  über Browser
- **Geschäftsjahre** – Mehrjahresfähigkeit, Jahresabschluss
- **Einstellungen** – Vereinsdaten, Bankverbindung, Standardkonten, Gemini-Key,
  Firebase-CORS-Setup

## KI-Funktionen (Gemini)

API-Key wird nur lokal im Browser (LocalStorage) abgelegt, geht nicht in
Firebase. Key holen unter
[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
und in **Einstellungen → KI-Funktionen** eintragen. Verfügbar:

- **Buchungsvorschlag**: aus der Beschreibung schlägt Gemini Soll/Haben/Betrag vor.
- **Beleg-Auto-Analyse**: Quittung hochladen → Gemini liest Datum, Betrag,
  Anbieter, Kontovorschlag.
- **Kontenplan-Generator**: Verein beschreiben → angepasster Schweizer Kontenplan.

Standardmodell `gemini-1.5-flash`. In den Einstellungen umschaltbar.

## Tech-Stack

- **Frontend**: statisches HTML + ES-Module (kein Build-Step)
- **Storage**: Firebase Storage (JSON-Dateien + Belege-Binärfiles)
- **Buchhaltungs-Engine**: rein im Browser (`public/js/accounting.js`)
- **Deployment**: Netlify (nur statisches Hosting)

## Firebase einrichten

Die App nutzt das Firebase-Projekt `jupidu-36804` (Konfiguration in
`public/js/firebase.js`). Alle Daten liegen unter dem Namensraum
`buchhaltung-sp-ar/` im Bucket – andere Apps im selben Projekt sind
nicht betroffen.

### 1. CORS auf dem Firebase Storage Bucket erlauben

Damit der Browser direkt auf den Bucket zugreifen darf, muss CORS
konfiguriert sein. Mit `gsutil`:

```bash
# cors.json
[
  {
    "origin": ["https://DEINE-NETLIFY-DOMAIN.netlify.app", "http://localhost:8080"],
    "method": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "responseHeader": ["Content-Type", "Content-Length", "x-goog-meta-foo"],
    "maxAgeSeconds": 3600
  }
]

gsutil cors set cors.json gs://jupidu-36804.firebasestorage.app
```

### 2. Firebase Storage Security Rules

Für den Start (öffentliches Lesen, anonymes Schreiben):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /buchhaltung-sp-ar/{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

**Achtung:** Diese Regeln machen alle Daten öffentlich lese- und
beschreibbar. Für den Produktivbetrieb unbedingt mit Auth absichern
(z.B. Firebase Auth + `request.auth != null`).

## Datenstruktur (Firebase Storage)

| Pfad                                                   | Inhalt                       |
|--------------------------------------------------------|------------------------------|
| `buchhaltung-sp-ar/data/einstellungen.json`            | Vereinsstammdaten            |
| `buchhaltung-sp-ar/data/kontenplan.json`               | Liste aller Konten           |
| `buchhaltung-sp-ar/data/geschaeftsjahre.json`          | Liste der Geschäftsjahre     |
| `buchhaltung-sp-ar/data/buchungen-<jahr>.json`         | Journal pro Geschäftsjahr    |
| `buchhaltung-sp-ar/data/mitglieder.json`               | Mitgliederliste              |
| `buchhaltung-sp-ar/data/rechnungen-<jahr>.json`        | Rechnungen pro Geschäftsjahr |
| `buchhaltung-sp-ar/data/belege-meta.json`              | Metadaten aller Belege       |
| `buchhaltung-sp-ar/files/belege/<id>-<dateiname>`      | Belegdatei (binär)           |

## Lokal entwickeln

```bash
npm run dev   # startet npx serve auf http://localhost:8080
```

Für lokales Arbeiten muss in der CORS-Konfiguration `http://localhost:8080`
freigeschaltet sein (siehe oben).

## Auf Netlify deployen

1. Repository mit Netlify verbinden.
2. Build-Settings werden aus `netlify.toml` gelesen – kein Build, nur
   `public/` wird publiziert.
3. Nach dem ersten Deploy: die Netlify-Domain in der CORS-Konfiguration
   des Firebase-Buckets ergänzen.

## Anpassen

- **Firebase-Projekt wechseln**: `FIREBASE_CONFIG` in
  `public/js/firebase.js`.
- **Theme/Farben**: CSS-Variablen in `public/styles.css`.
- **Default-Kontenplan**: `public/js/defaults.js`.
- **Buchhaltungs-Logik**: `public/js/accounting.js`.
- **Views**: `public/js/views/`.

### Authentifizierung (TODO vor Produktiveinsatz)

Aktuell ist **keine Authentifizierung** eingebaut. Empfohlen:
- Firebase Authentication (Email/Password oder Google) als Login-Wall
  vor der App, anschliessend Security Rules auf `request.auth != null`
  umstellen.
- Alternativ: Netlify Identity / Edge-Function-Basic-Auth.
