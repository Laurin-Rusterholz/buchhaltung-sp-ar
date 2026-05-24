// Buchhaltungs-Logik: Saldo, Bilanz, Erfolgsrechnung, Kontoauszug
// Reine Funktionen, ohne Side-Effects – einfach zu testen und anzupassen.

export function kontoSaldo(kontoNr, typ, buchungen) {
  let soll = 0, haben = 0;
  for (const b of buchungen) {
    if (b.soll === kontoNr) soll += Number(b.betrag);
    if (b.haben === kontoNr) haben += Number(b.betrag);
  }
  // Aktiv- und Aufwandkonten: Soll - Haben
  // Passiv- und Ertragkonten: Haben - Soll
  if (typ === 'aktiv' || typ === 'aufwand') return soll - haben;
  return haben - soll;
}

export function bilanz(konten, buchungen, einstellungen) {
  const aktiven = [];
  const passiven = [];
  for (const k of konten) {
    const s = kontoSaldo(k.nummer, k.typ, buchungen);
    if (k.typ === 'aktiv') {
      if (s !== 0) aktiven.push({ nummer: k.nummer, bezeichnung: k.bezeichnung, saldo: s });
    } else if (k.typ === 'passiv') {
      // Jahresergebnis-Konto separat ausweisen
      const isErgebnis = einstellungen?.konto_ergebnis && k.nummer === einstellungen.konto_ergebnis;
      if (isErgebnis) continue;
      if (s !== 0) passiven.push({ nummer: k.nummer, bezeichnung: k.bezeichnung, saldo: s });
    }
  }
  aktiven.sort((a, b) => a.nummer.localeCompare(b.nummer));
  passiven.sort((a, b) => a.nummer.localeCompare(b.nummer));

  const total_aktiven = aktiven.reduce((s, e) => s + e.saldo, 0);
  const total_passiven_ohne_ergebnis = passiven.reduce((s, e) => s + e.saldo, 0);
  const ergebnis = berechneErgebnis(konten, buchungen);

  return {
    aktiven,
    passiven,
    total_aktiven,
    eigenkapital: total_passiven_ohne_ergebnis,
    jahresergebnis: ergebnis,
    total_passiven: total_passiven_ohne_ergebnis + ergebnis,
  };
}

export function erfolgsrechnung(konten, buchungen) {
  const ertrag = [];
  const aufwand = [];
  for (const k of konten) {
    const s = kontoSaldo(k.nummer, k.typ, buchungen);
    if (s === 0) continue;
    if (k.typ === 'ertrag') ertrag.push({ nummer: k.nummer, bezeichnung: k.bezeichnung, saldo: s });
    if (k.typ === 'aufwand') aufwand.push({ nummer: k.nummer, bezeichnung: k.bezeichnung, saldo: s });
  }
  ertrag.sort((a, b) => a.nummer.localeCompare(b.nummer));
  aufwand.sort((a, b) => a.nummer.localeCompare(b.nummer));
  const total_ertrag = ertrag.reduce((s, e) => s + e.saldo, 0);
  const total_aufwand = aufwand.reduce((s, e) => s + e.saldo, 0);
  return { ertrag, aufwand, total_ertrag, total_aufwand };
}

export function berechneErgebnis(konten, buchungen) {
  const er = erfolgsrechnung(konten, buchungen);
  return er.total_ertrag - er.total_aufwand;
}

export function kontoauszug(konto, buchungen) {
  const zeilen = [];
  let saldo = 0;
  const sorted = buchungen
    .filter((b) => b.soll === konto.nummer || b.haben === konto.nummer)
    .sort((a, b) => a.datum.localeCompare(b.datum) || (a.beleg_nr || '').localeCompare(b.beleg_nr || ''));

  for (const b of sorted) {
    const isSoll = b.soll === konto.nummer;
    const sollBetrag = isSoll ? Number(b.betrag) : 0;
    const habenBetrag = !isSoll ? Number(b.betrag) : 0;
    if (konto.typ === 'aktiv' || konto.typ === 'aufwand') {
      saldo += sollBetrag - habenBetrag;
    } else {
      saldo += habenBetrag - sollBetrag;
    }
    zeilen.push({
      datum: b.datum,
      beleg_nr: b.beleg_nr,
      beschreibung: b.beschreibung,
      gegenkonto: isSoll ? b.haben : b.soll,
      soll: sollBetrag,
      haben: habenBetrag,
      saldo,
    });
  }
  const total_soll = zeilen.reduce((s, z) => s + z.soll, 0);
  const total_haben = zeilen.reduce((s, z) => s + z.haben, 0);
  return {
    nummer: konto.nummer,
    bezeichnung: konto.bezeichnung,
    typ: konto.typ,
    zeilen,
    total_soll,
    total_haben,
    saldo,
  };
}
