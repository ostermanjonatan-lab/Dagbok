# Dagbok

En liten dagboksapp för telefonen. Skriv vad som hänt och välj humör på en färgskala för varje dag. Vädret sparas automatiskt: vädret kl 12 den dagen, eller vädret när du sparar om du skriver dagens inlägg före kl 12. Allt sparas automatiskt i webbläsaren på enheten och appen fungerar utan nät.

## Installera på telefonen

1. Aktivera GitHub Pages: Settings, Pages, Source: **GitHub Actions**. Arbetsflödet i `.github/workflows/pages.yml` publicerar sedan sidan.
2. Öppna sidans adress på telefonen.
   - iPhone (Safari): Dela, Lägg till på hemskärmen.
   - Android (Chrome): menyn, Installera app.

## Väder

Vädret hämtas från Open-Meteo med telefonens position, som avrundas till ungefär en kilometer. Första gången frågar telefonen om appen får använda platsen. Artifact-versionen (`artifact.html`) kan inte hämta väder, eftersom claude.ai stoppar anrop till andra webbplatser, men den visar väder som följer med vid import.

## Data

Inläggen ligger i `localStorage` på den enhet du skriver på och skickas ingenstans. Använd Exportera fil under Alla dagar för en säkerhetskopia, och Importera fil för att flytta till en annan enhet. Vid import behålls den senast ändrade versionen av varje dag.

## Köra lokalt

```
python3 -m http.server
```

Öppna sedan http://localhost:8000.

När du ändrar filerna, höj `CACHE` i `sw.js` så att installerade appar hämtar den nya versionen.
