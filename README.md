# Dagbok

En liten dagboksapp för telefonen. Skriv det viktigaste som hänt, anteckningar, humör, sömn, tacksamhet och taggar för varje dag. Allt sparas automatiskt i webbläsaren på enheten och appen fungerar utan nät.

## Installera på telefonen

1. Aktivera GitHub Pages: Settings, Pages, Source: **GitHub Actions**. Arbetsflödet i `.github/workflows/pages.yml` publicerar sedan sidan.
2. Öppna sidans adress på telefonen.
   - iPhone (Safari): Dela, Lägg till på hemskärmen.
   - Android (Chrome): menyn, Installera app.

## Data

Inläggen ligger i `localStorage` på den enhet du skriver på och skickas ingenstans. Använd Exportera fil under Alla dagar för en säkerhetskopia, och Importera fil för att flytta till en annan enhet. Vid import behålls den senast ändrade versionen av varje dag.

## Köra lokalt

```
python3 -m http.server
```

Öppna sedan http://localhost:8000.

När du ändrar filerna, höj `CACHE` i `sw.js` så att installerade appar hämtar den nya versionen.
