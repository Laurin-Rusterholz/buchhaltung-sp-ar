# Vereinsbuchhaltung (Basis SP AR)

Umfassende Buchhaltungs-Webapp für Schweizer Vereine. Doppelte Buchhaltung,
Schweizer Vereins-Kontenplan, Mitglieder-, Rechnungs- und Belegverwaltung,
Bilanz und Erfolgsrechnung. Statische Webapp – kein Backend nötig.

Persistenz läuft direkt aus dem Browser gegen **Firebase Firestore**
(strukturierte Daten – keine CORS-Probleme) und **Firebase Storage**
(Belegdateien). Deployment auf Netlify.

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
- **Daten**: Firebase Firestore (Collection `buchhaltung-sp-ar`)
- **Belegdateien**: Firebase Storage (`buchhaltung-sp-ar/files/belege/`)
- **Buchhaltungs-Engine**: rein im Browser (`public/js/accounting.js`)
- **AI**: Gemini API direkt aus dem Browser (Key in LocalStorage)
- **Deployment**: Netlify (nur statisches Hosting)

## Firebase einrichten

Die App nutzt das Firebase-Projekt `jupidu-36804` (Konfiguration in
`public/js/firebase.js`). Alle Daten liegen unter der Firestore-Collection
`buchhaltung-sp-ar` bzw. dem Storage-Ordner `buchhaltung-sp-ar/` – andere
Apps im selben Projekt sind nicht betroffen.

### 1. Firestore aktivieren

[Firebase Console → Firestore Database](https://console.firebase.google.com/project/jupidu-36804/firestore)
öffnen und „Create database" klicken (Production mode, Region nach Wahl).

### 2. Firestore Security Rules

Im Tab „Rules" einfügen und „Publish":

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /buchhaltung-sp-ar/{docId} {
      allow read, write: if true;
    }
  }
}
```

### 3. Storage Rules für Belege

Falls noch nicht offen, in Storage → Rules ergänzen:

```
match /buchhaltung-sp-ar/{allPaths=**} {
  allow read, write: if true;
}
```

**Achtung:** Diese Regeln machen alle Daten öffentlich lese- und
beschreibbar. Für den Produktivbetrieb unbedingt mit Firebase Auth
absichern (z.B. `if request.auth != null`).

## Datenstruktur

### Firestore (Collection `buchhaltung-sp-ar`)

| Document               | Inhalt                       |
|------------------------|------------------------------|
| `einstellungen`        | Vereinsstammdaten            |
| `kontenplan`           | Liste aller Konten           |
| `geschaeftsjahre`      | Liste der Geschäftsjahre     |
| `buchungen-<jahr>`     | Journal pro Geschäftsjahr    |
| `mitglieder`           | Mitgliederliste              |
| `rechnungen-<jahr>`    | Rechnungen pro Geschäftsjahr |
| `belege-meta`          | Metadaten aller Belege       |

Jedes Dokument hat das Schema `{ data: <payload>, updated_at: timestamp }`.

### Storage

| Pfad                                              | Inhalt              |
|---------------------------------------------------|---------------------|
| `buchhaltung-sp-ar/files/belege/<id>-<dateiname>` | Belegdatei (binär)  |

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
