# Tonlabor – Gesangstrainer (vocal-coach)

Gesangstrainer, der im Browser läuft: Töne und Intervalle werden grafisch vorgegeben, dann singst du ein. Die App wertet aus:

- **Tonhöhe:** Abweichung in Cent, Schwankung, Einsatzzeit, Anschleifen von unten. Oktavversatz wird erkannt und nicht bestraft.
- **Lautstärke:** Pegel in dBFS, Schwankung, Abfall zum Tonende
- **Klang:** luftig ↔ ausgewogen ↔ gepresst (CPP, HNR, H1–H2, Alpha-Ratio). Lässt sich auf die eigene Stimme kalibrieren.

Lektionen: Einzelton, Intervalle (kleine Sekunde bis Oktave, aufwärts und abwärts), Tonleiter, Dreiklang. Stimmlagen von Bass bis Sopran.

Alle Berechnungen laufen lokal im Browser. Es werden keine Aufnahmen hochgeladen.

## Dateien

- `index.html`: die fertige App als eine einzige Datei, direkt nutzbar
- `dsp.js`: der Analyse-Kern (YIN, Klangmerkmale, Bewertung, Modellstimme)
- `app.html`: die Oberfläche mit dem Platzhalter `/*__DSP__*/`
- `test.js`: Tests mit synthetischen Stimmen (`node test.js`)

Nach Änderungen an `dsp.js` oder `app.html` neu bauen:

```sh
python3 -c "open('index.html','w').write(open('app.html').read().replace('/*__DSP__*/', open('dsp.js').read()))"
```

## Live-Modus

Das Mikrofon funktioniert nur, wenn die Seite über https läuft, zum Beispiel über GitHub Pages: *Settings → Pages → Branch `main`, Ordner `/ (root)`*. Ohne Mikrofon kannst du eine Aufnahme hochladen (WAV, M4A oder MP3). Anfang und Ende werden automatisch an die Übung angepasst.

## Quellen

- de Cheveigné & Kawahara (2002): YIN, a fundamental frequency estimator. https://doi.org/10.1121/1.1458024
- Hillenbrand, Cleveland & Erickson (1994): Acoustic correlates of breathy vocal quality. https://doi.org/10.1044/jshr.3704.769
- Stoller & Dixon (2016): Analysis and classification of phonation modes in singing, ISMIR. https://archives.ismir.net/ismir2016/paper/000233.pdf
- VocalSet (offener Datensatz für die Kalibrierung der Schwellenwerte): https://zenodo.org/records/1442513

## Stand

Die Klangschwellen sind bisher nur mit Modellstimmen getestet. Nächster Schritt: sie mit VocalSet und echten iPhone-Aufnahmen nachjustieren.
