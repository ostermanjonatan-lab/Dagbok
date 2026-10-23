# Testdata

`dagbok-testdata-2-ar.json` innehåller påhittade inlägg från 23 oktober 2024 till 22 oktober 2026: 562 dagar med text, humör, väder kl 12 och 50 enkla bilder. Ungefär var femte vardag saknas, som i en riktig dagbok. Högtider som julafton och midsommar har rubrik, lista och bilder.

Importera filen under Kalender, längst ner: Importera fil. Dagar som redan finns och är ändrade senare behålls.

Skapa filen igen med samma innehåll:

```
python3 testdata/generate.py testdata/dagbok-testdata-2-ar.json
```
